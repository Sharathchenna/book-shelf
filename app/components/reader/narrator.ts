/**
 * Reads a book aloud, highlighting each sentence on the page as it's spoken.
 *
 * Chapters already saved (as MP3 in storage) stream from there, on any device. Others are spoken
 * sentence by sentence by Kokoro: on the GPU server when there is one (narrator-server/, which
 * also saves chapters itself, so "save the whole book" carries on with the tab closed), else
 * here, in a worker (narrator.worker.ts). Without the server, a browser with a GPU records a
 * chapter heard from its start as it plays and saves it, and "save the whole book" records the
 * rest, so a phone can play the book without making any of it.
 */
import type { AudioLine, AudioSection } from "@/lib/library-types";
import type { FoliateView } from "./foliate";
import type { Engine, Reply, Request } from "./narrator.worker";
import { locate, offsetAt, rangeFor, sayable, speechText, spoken, type SpeechText } from "./speech";

export const VOICES = [
  { id: "af_heart", name: "Heart", accent: "American" },
  { id: "af_bella", name: "Bella", accent: "American" },
  { id: "bf_emma", name: "Emma", accent: "British" },
  { id: "am_michael", name: "Michael", accent: "American" },
  { id: "bm_george", name: "George", accent: "British" },
] as const;
export const RATES = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2];

const SAMPLE_RATE = 24_000;
/** Silence after a sentence, in seconds: longer at the end of a paragraph, longest after a heading. */
const PAUSE = { sentence: 0.18, paragraph: 0.5, heading: 0.8 };
/** Sentences spoken ahead of the one playing. */
const AHEAD = 3;
/** Saved chapters' URLs last 15 minutes; fetch a fresh one after this long. */
const URL_FRESH_MS = 10 * 60_000;
const PREFS_KEY = "narrator";

export type NarratorState = {
  status: "off" | "loading" | "playing" | "paused" | "error";
  error?: string;
  /** Downloading the voice model, the first time: bytes so far and in all. */
  download?: { loaded: number; total: number };
  voice: string;
  rate: number;
  section: number;
  /** The sentence being read, and how many the chapter has. */
  line: number;
  lines: number;
  /** In a saved chapter: seconds in, and its length. */
  time?: { at: number; duration: number };
  /** Waiting for the next sentence to be spoken. */
  waiting: boolean;
  /** The page shown isn't the one being read (the reader turned away). */
  away: boolean;
  /** Chapters saved in this voice. */
  saved: number;
  /** Chapters there are to save. */
  savable: number;
  /**
   * Saving chapters: the one being saved, how far into it (sentences made, of how many, and
   * roughly how many seconds are left), and how many more are waiting. `remote` when the GPU
   * server is saving them, which carries on with the tab closed.
   */
  saving: { section: number | null; made?: number; total?: number; left?: number; queued?: number; remote?: boolean } | null;
  /** Where the voice runs, once known. Saving needs the GPU server, or a GPU here. */
  engine?: Voicing;
};

/** Where the voice runs: the GPU server, or this browser (on its GPU, else its CPU). */
export type Voicing = Engine | { device: "server" };

/** A sentence to read: where it is in its chapter's text, what to say, and the pause after it. */
type Line = { start: number; end: number; text: string; say: string; pause: number };
type Script = { section: number; lines: Line[] };
type Saved = AudioSection & { url: string; fetchedAt: number };
/** A chapter the GPU server is saving, as it reports it. */
type ServerJob = { section: number; state: "queued" | "making" | "saving" | "done" | "failed" | "cancelled"; made: number; total: number; left?: number; error?: string };

class Stopped extends Error {}

/** A request to the worker, before it's given an id. */
type Ask = Request extends infer R ? (R extends unknown ? Omit<R, "id"> : never) : never;

/** Sentences asked of the GPU server at once: enough to hide the trip there and back. */
const SERVER_AT_ONCE = 4;
/** How often to ask the GPU server how its chapters are getting on. */
const WATCH_MS = 2500;

/** Whether the GPU server is there to read with. */
async function serverUp(): Promise<boolean> {
  const res = await fetch("/api/narrate").catch(() => null);
  return Boolean(res?.ok && ((await res.json()) as { available?: boolean }).available);
}

/** A sentence spoken by the GPU server, or null when it isn't answering. */
async function spokenByServer(text: string, voice: string): Promise<Float32Array | null> {
  const res = await fetch("/api/narrate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voice }),
  }).catch(() => null);
  if (!res || res.status >= 500) return null;
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The voice couldn't say that.");
  const pcm = new Int16Array(await res.arrayBuffer());
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const prefs = (): { voice: string; rate: number } => {
  try {
    return { voice: VOICES[0].id, rate: 1, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return { voice: VOICES[0].id, rate: 1 };
  }
};

/**
 * The voice: the GPU server when it's there, else Kokoro in the worker, which also splits text
 * into sentences and encodes MP3 either way. Sentences are spoken most urgent first: one at a
 * time here, a few at once on the server.
 */
class Voice {
  private worker = new Worker(new URL("./narrator.worker.ts", import.meta.url), { type: "module" });
  private next = 1;
  private pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  private queue: { priority: () => number; wanted: () => boolean; start: () => void; reject: (e: Error) => void }[] = [];
  private speaking = 0;
  private atOnce = 1;
  engine: Promise<Voicing>;

  constructor(
    onProgress: (loaded: number, total: number) => void,
    server: Promise<boolean>,
    /** Told when the voice moves here from the server, which stopped answering. */
    private onFallBack: (engine: Promise<Voicing>) => void,
  ) {
    this.worker.addEventListener("message", (event: MessageEvent<Reply>) => {
      const reply = event.data;
      if ("type" in reply) return onProgress(reply.loaded, reply.total);
      const waiting = this.pending.get(reply.id);
      this.pending.delete(reply.id);
      if ("error" in reply) waiting?.reject(new Error(reply.error));
      else waiting?.resolve(reply.result as never);
    });
    this.worker.addEventListener("error", (event) => {
      for (const { reject } of this.pending.values()) reject(new Error(event.message || "The voice stopped working."));
      this.pending.clear();
    });
    this.engine = server.then((up): Promise<Voicing> | Voicing => {
      if (!up) return this.call<Engine>({ type: "load" });
      this.atOnce = SERVER_AT_ONCE;
      return { device: "server" } as const;
    });
  }

  /** The server stopped answering: the voice here takes over (loading the model, the first time). */
  private fallBack() {
    if (this.atOnce === 1) return;
    this.atOnce = 1;
    this.engine = this.call<Engine>({ type: "load" });
    this.onFallBack(this.engine);
  }

  private async say(text: string, voice: string): Promise<Float32Array> {
    if ((await this.engine).device === "server") {
      const pcm = await spokenByServer(text, voice);
      if (pcm) return pcm;
      this.fallBack();
    }
    return this.call<Float32Array>({ type: "speak", text, voice });
  }

  private call<T>(request: Ask, transfer: Transferable[] = []): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject });
      this.worker.postMessage({ ...request, id } as Request, transfer);
    });
  }

  split(texts: string[]) {
    return this.call<[number, number][][]>({ type: "split", texts });
  }

  /** Speaks `text`. Lower `priority` goes first; dropped if no longer `wanted` when its turn comes. */
  speak(text: string, voice: string, priority: () => number, wanted: () => boolean = () => true): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        priority,
        wanted,
        reject,
        start: () => {
          this.say(text, voice)
            .then(resolve, reject)
            .finally(() => {
              this.speaking--;
              this.pump();
            });
        },
      });
      // After the caller has kept the promise, so `wanted` sees it.
      queueMicrotask(() => this.pump());
    });
  }

  private pump() {
    this.queue = this.queue.filter((job) => job.wanted() || void job.reject(new Stopped()));
    while (this.speaking < this.atOnce && this.queue.length) {
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].priority() < this.queue[best].priority()) best = i;
      const [job] = this.queue.splice(best, 1);
      this.speaking++;
      job.start();
    }
  }

  encodeBegin(key: string) {
    return this.call<null>({ type: "encode-begin", key });
  }
  encodeAdd(key: string, pcm: Float32Array) {
    return this.call<null>({ type: "encode-add", key, pcm }, [pcm.buffer]);
  }
  encodeEnd(key: string) {
    return this.call<Uint8Array>({ type: "encode-end", key });
  }

  terminate() {
    this.worker.terminate();
    for (const { reject } of this.pending.values()) reject(new Stopped());
    for (const job of this.queue) job.reject(new Stopped());
  }
}

/** A chapter being recorded: every sentence in order, encoded to MP3 as it comes, then saved. */
type Take = {
  section: number;
  voice: string;
  cancelled: boolean;
  done: Promise<void>;
  lines: Map<number, Promise<Float32Array>>;
  /** Sentences encoded so far, of how many, and when the recording started. */
  made: number;
  total: number;
  started: number;
};

const silence = (seconds: number) => new Float32Array(Math.round(SAMPLE_RATE * seconds));

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** 16-bit mono WAV, for playing a spoken sentence in an <audio> element. */
function wav(pcm: Float32Array): Blob {
  const data = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const text = (at: number, s: string) => [...s].forEach((c, i) => data.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  data.setUint32(4, 36 + pcm.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, SAMPLE_RATE, true);
  data.setUint32(28, SAMPLE_RATE * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  text(36, "data");
  data.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    data.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([data.buffer], { type: "audio/wav" });
}

export type NarratorBook = {
  id: string;
  title: string;
  author: string;
  paper: boolean;
  /** Per section: its title, and whether it has anything to read. */
  sections: { title: string; chars: number }[];
};

export class Narrator {
  private state: NarratorState;
  private subscribers = new Set<() => void>();
  private audio = new Audio();
  private voice: Voice | null = null;
  /** Bumped by every start and stop; a playback loop that sees a different number stops. */
  private run = 0;
  private interrupt: (() => void) | null = null;
  /** Starts the sentence that was made while paused. */
  private onResume: (() => void) | null = null;
  private savedSections = new Map<number, number>();
  private savedCache = new Map<number, Promise<Saved>>();
  private scripts = new Map<number, Promise<Script>>();
  private clips = new Map<string, Promise<Float32Array>>();
  private takes = new Map<string, Take>();
  private job: { cancelled: boolean } | null = null;
  /** Whether the GPU server is there, asked once. */
  private server: Promise<boolean> | null = null;
  /** Chapters given to the GPU server to save, by voice and section. */
  private sent = new Set<string>();
  private watcher: Promise<void> | null = null;
  private destroyed = false;
  private texts = new WeakMap<Document, SpeechText>();
  /** The sentence being read: its place in its chapter's text. */
  private reading: { section: number; start: number; end: number; text: string } | null = null;
  private range: Range | null = null;
  private frame = 0;
  private savedLines: AudioLine[] | null = null;

  constructor(
    private view: FoliateView,
    private book: NarratorBook,
  ) {
    const { voice, rate } = prefs();
    this.state = {
      status: "off",
      voice,
      rate,
      section: 0,
      line: 0,
      lines: 0,
      waiting: false,
      away: false,
      saved: 0,
      savable: book.sections.filter((_, i) => this.readable(i)).length,
      saving: null,
    };
    this.audio.preload = "auto";
    this.audio.defaultPlaybackRate = rate;
    view.addEventListener("relocate", this.onRelocate);
    view.addEventListener("load", this.onLoad);
  }

  // ---- state, for React ---------------------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.subscribers.add(fn);
    return () => void this.subscribers.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<NarratorState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.subscribers) fn();
  }

  // ---- controls -----------------------------------------------------------------------------

  /** Starts reading at the top of the page on screen. Call from a click: browsers only let a page start audio then. */
  start() {
    this.unlock();
    const here = this.visibleOffset();
    void this.play(here.section, here.offset);
  }

  /** Starts reading at a passage (from a selection). */
  startAt(section: number, range: Range) {
    this.unlock();
    void this.play(section, offsetAt(this.textOf(range.startContainer.ownerDocument!), range.startContainer, range.startOffset));
  }

  pause() {
    if (this.state.status !== "playing" && this.state.status !== "loading") return;
    this.audio.pause();
    this.set({ status: "paused" });
    this.updateSession();
  }

  resume() {
    if (this.state.status !== "paused") return;
    this.set({ status: "playing" });
    if (this.onResume) this.onResume();
    else void this.audio.play().catch(() => {});
    this.updateSession();
  }

  toggle() {
    if (this.state.status === "paused") this.resume();
    else if (this.state.status === "playing" || this.state.status === "loading") this.pause();
    else this.start();
  }

  /** Next or previous sentence. */
  skip(by: 1 | -1) {
    const { section, line } = this.state;
    if (this.savedLines && this.state.time) {
      const target = this.savedLines[line + by];
      if (target) {
        this.audio.currentTime = target.t0;
        return;
      }
    }
    void this.lineOffset(section, line + by).then((at) => {
      if (at === null) return this.chapter(by);
      void this.play(section, at);
    });
  }

  /** Next chapter, or back to the start of this one (or the one before, when near its start). */
  chapter(by: 1 | -1) {
    let { section } = this.state;
    if (by === -1 && this.state.line < 2) section -= 1;
    else if (by === 1) section += 1;
    while (section >= 0 && section < this.book.sections.length && !this.readable(section)) section += by;
    if (section < 0 || section >= this.book.sections.length) return;
    void this.play(section, 0);
  }

  setRate(rate: number) {
    this.audio.defaultPlaybackRate = rate;
    this.audio.playbackRate = rate;
    this.set({ rate });
    this.savePrefs();
  }

  setVoice(voice: string) {
    if (voice === this.state.voice) return;
    this.stopSaving();
    for (const take of this.takes.values()) take.cancelled = true;
    this.takes.clear();
    this.clips.clear();
    this.savedCache.clear();
    this.set({ voice });
    this.savePrefs();
    const wasOn = this.state.status !== "off" && this.state.status !== "error";
    const at = this.reading;
    void this.loadSaved().then(() => {
      if (wasOn && at) void this.play(at.section, at.start);
    });
  }

  /** Stops reading. Saving the book, if it's running, carries on. */
  stop() {
    this.run++;
    this.interrupt?.();
    this.onResume = null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    cancelAnimationFrame(this.frame);
    for (const [key, take] of this.takes) {
      if (!this.job || take.section !== this.state.saving?.section) {
        take.cancelled = true;
        this.takes.delete(key);
      }
    }
    this.clips.clear();
    this.reading = null;
    this.savedLines = null;
    this.highlight(null);
    this.set({ status: "off", waiting: false, time: undefined, away: false });
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
  }

  /** Back to the page being read, after turning away from it. */
  follow() {
    const reading = this.reading;
    if (!reading) return;
    if (this.range && this.isRendered(this.range)) void this.view.renderer.scrollToAnchor(this.range);
    else void this.view.goTo(reading.section).then(() => this.show());
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    // The GPU server's saving carries on without the page; the browser's own doesn't.
    if (!this.state.saving?.remote) this.stopSaving();
    this.view.removeEventListener("relocate", this.onRelocate);
    this.view.removeEventListener("load", this.onLoad);
    this.voice?.terminate();
    this.voice = null;
  }

  // ---- saving the whole book ----------------------------------------------------------------

  /**
   * Saves every chapter not yet saved in this voice, starting with the one on screen: on the GPU
   * server when there is one, else recorded here, which needs a GPU.
   */
  async saveBook() {
    if (this.job) return;
    const job = { cancelled: false };
    this.job = job;
    this.set({ saving: { section: null }, error: undefined });
    try {
      const engine = await this.ensureVoice().engine;
      this.set({ engine });
      if (engine.device === "server") return await this.saveOnServer(job);
      if (engine.device !== "webgpu") throw new Error("Saving the book needs a browser with WebGPU, such as Chrome or Safari on a computer.");
      await this.loadSaved();
      for (const section of this.saveOrder()) {
        if (job.cancelled) break;
        if (!this.readable(section) || this.savedSections.has(section)) continue;
        this.set({ saving: { section } });
        const take = this.record(await this.script(section));
        this.showTake(take);
        await take.done;
      }
    } catch (error) {
      if (!(error instanceof Stopped)) this.set({ error: (error as Error).message });
    } finally {
      if (this.job === job) {
        this.job = null;
        this.set({ saving: null });
      }
    }
  }

  /** Every chapter, starting with the one being read (or shown). */
  private saveOrder(): number[] {
    const from = this.state.status === "off" ? this.visibleOffset().section : this.state.section;
    const n = this.book.sections.length;
    return [...Array(n).keys()].map((i) => (from + i) % n);
  }

  /** Gives the GPU server every chapter not saved yet, a few at a time, then follows it until it's done. */
  private async saveOnServer(job: { cancelled: boolean }) {
    await this.loadSaved(true);
    const wanted = this.saveOrder().filter((section) => this.readable(section) && !this.savedSections.has(section));
    this.set({ saving: { section: null, remote: true } });
    // The server starts on the first chapters while the rest are being split into sentences.
    for (let i = 0; i < wanted.length && !job.cancelled; i += 3) await this.sendChapters(wanted.slice(i, i + 3), false);
    if (!job.cancelled) await this.watch();
  }

  /** Asks the GPU server to save chapters; `urgent` puts them before any it's already saving. */
  private async sendChapters(sections: number[], urgent: boolean) {
    const voice = this.state.voice;
    const fresh = sections.filter((s) => !this.savedSections.has(s) && (urgent || !this.sent.has(`${voice}:${s}`)));
    const scripts = await Promise.all(fresh.map((s) => this.script(s)));
    const chapters = scripts.filter((script) => script.lines.length).map(({ section, lines }) => ({ section, lines }));
    if (!chapters.length) return;
    const res = await fetch(`/api/books/${this.book.id}/narrate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice, chapters, urgent }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The narrator server didn't take the chapters.");
    for (const { section } of chapters) this.sent.add(`${voice}:${section}`);
    void this.watch();
  }

  /**
   * Follows the chapters the GPU server is saving for this book until none are left, showing
   * how far it has got and picking up each chapter as it's saved (which lets reading switch to it).
   */
  private watch(): Promise<void> {
    this.watcher ??= (async () => {
      const reported = new Set<number>();
      try {
        while (!this.destroyed) {
          const voice = this.state.voice;
          const res = await fetch(`/api/books/${this.book.id}/narrate?voice=${voice}`).catch(() => null);
          if (!res?.ok || voice !== this.state.voice) break;
          const { jobs } = (await res.json()) as { jobs: ServerJob[] };
          if (jobs.some((j) => j.state === "done" && !this.savedSections.has(j.section))) await this.loadSaved(true);
          for (const j of jobs) {
            if (j.state !== "failed" || reported.has(j.section)) continue;
            reported.add(j.section);
            this.set({ error: `Couldn't save “${this.book.sections[j.section]?.title || `chapter ${j.section + 1}`}”: ${j.error}` });
          }
          const active = jobs.filter((j) => j.state === "queued" || j.state === "making" || j.state === "saving");
          if (!active.length) break;
          const current = active.find((j) => j.state !== "queued");
          this.set({
            saving: { section: current?.section ?? null, made: current?.made, total: current?.total, left: current?.left, queued: active.length - (current ? 1 : 0), remote: true },
          });
          await sleep(WATCH_MS);
        }
      } finally {
        this.watcher = null;
        if (this.state.saving?.remote) this.set({ saving: null });
      }
    })();
    return this.watcher;
  }

  stopSaving() {
    if (this.state.saving?.remote) {
      const voice = this.state.voice;
      void fetch(`/api/books/${this.book.id}/narrate?voice=${voice}`, { method: "DELETE" }).catch(() => {});
      for (const key of this.sent) if (key.startsWith(`${voice}:`)) this.sent.delete(key);
      if (this.job) this.job.cancelled = true;
      this.job = null;
      this.set({ saving: null });
      return;
    }
    if (!this.job) return;
    this.job.cancelled = true;
    const section = this.state.saving?.section;
    // The chapter being saved stops too, unless it's the one being listened to.
    for (const [key, take] of this.takes) {
      if (take.section === section && !(this.state.status !== "off" && this.state.section === section)) {
        take.cancelled = true;
        this.takes.delete(key);
      }
    }
    this.job = null;
    this.set({ saving: null });
  }

  // ---- playback -----------------------------------------------------------------------------

  private async play(section: number, offset: number) {
    const run = ++this.run;
    this.interrupt?.();
    this.onResume = null;
    this.audio.pause();
    cancelAnimationFrame(this.frame);
    this.savedLines = null;
    this.set({ status: "loading", section, waiting: true, error: undefined, time: undefined });
    try {
      await this.loadSaved();
      let first = true;
      for (; section < this.book.sections.length; section++) {
        if (run !== this.run) return;
        if (!this.readable(section)) continue;
        const from = first ? offset : 0;
        first = false;
        if (this.savedSections.has(section)) await this.playSaved(run, section, from);
        else await this.playSpoken(run, section, from);
      }
      if (run === this.run) this.stop();
    } catch (error) {
      if (error instanceof Stopped || run !== this.run) return;
      this.audio.pause();
      this.set({ status: "error", error: (error as Error).message, waiting: false });
    }
  }

  /** Plays a saved chapter from the first sentence ending after `offset`. */
  private async playSaved(run: number, section: number, offset: number) {
    let saved = await this.fetchSaved(section);
    if (run !== this.run) throw new Stopped();
    const lines = saved.lines;
    const first = Math.max(0, lines.findIndex((l) => l.end > offset));
    this.savedLines = lines;
    this.set({ section, line: first, lines: lines.length, waiting: false, time: { at: lines[first]?.t0 ?? 0, duration: saved.duration } });
    this.updateSession();

    await new Promise<void>((resolve, reject) => {
      const audio = this.audio;
      let line = -1;
      const tick = () => {
        const t = audio.currentTime;
        let i = Math.max(0, line);
        while (i + 1 < lines.length && lines[i + 1].t0 <= t + 0.05) i++;
        while (i > 0 && lines[i].t0 > t + 0.05) i--;
        if (i !== line) {
          line = i;
          this.speak(section, lines[i]);
          this.set({ line: i });
        }
        // The clock shows whole seconds; no need to re-render more often.
        if (Math.floor(t) !== Math.floor(this.state.time?.at ?? -1)) this.set({ time: { at: t, duration: saved.duration } });
        if (!audio.paused) this.frame = requestAnimationFrame(tick);
      };
      const onPlay = () => {
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(tick);
      };
      const onTime = () => audio.paused && tick();
      const onEnded = () => finish(resolve);
      // A URL that expired while paused: fetch a fresh one and carry on from the same place.
      const onError = async () => {
        const at = audio.currentTime;
        this.savedCache.delete(section);
        try {
          saved = await this.fetchSaved(section);
          if (run !== this.run) return;
          audio.src = saved.url;
          audio.currentTime = at;
          if (this.state.status === "playing") await audio.play();
        } catch (error) {
          finish(() => reject(error));
        }
      };
      const finish = (done: () => void) => {
        cancelAnimationFrame(this.frame);
        audio.removeEventListener("play", onPlay);
        audio.removeEventListener("timeupdate", onTime);
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        this.interrupt = null;
        done();
      };
      audio.addEventListener("play", onPlay);
      audio.addEventListener("timeupdate", onTime);
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);
      this.interrupt = () => finish(() => reject(new Stopped()));

      const seek = lines[first]?.t0 ?? 0;
      audio.src = saved.url;
      audio.playbackRate = this.state.rate;
      // Some browsers ignore a seek before the file's length is known; seek again once it is.
      audio.currentTime = seek;
      audio.addEventListener("loadedmetadata", () => seek && Math.abs(audio.currentTime - seek) > 0.5 && (audio.currentTime = seek), { once: true });
      tick();
      if (this.state.status !== "paused") {
        this.set({ status: "playing" });
        this.begin((error) => finish(() => reject(error)));
      }
    });
    this.savedLines = null;
  }

  /** Speaks a chapter sentence by sentence, from the first sentence ending after `offset`. */
  private async playSpoken(run: number, section: number, offset: number) {
    const voice = this.ensureVoice();
    const script = await this.script(section);
    if (run !== this.run) throw new Stopped();
    const lines = script.lines;
    const first = lines.findIndex((l) => l.end > offset);
    if (first < 0) return;
    const engine = await voice.engine;
    this.set({ engine, download: undefined });
    // The GPU server saves the chapter being heard before any other, and reading moves to the
    // saved chapter once it's there. Without it, a chapter heard from its start is recorded as
    // it plays, where the voice runs on a GPU here.
    const remote = engine.device === "server";
    if (remote) void this.sendChapters([section], true).catch(() => {});
    else if (first === 0 && engine.device === "webgpu") this.record(script);

    for (let i = first; i < lines.length; i++) {
      if (remote && i > first && this.savedSections.has(section)) return this.playSaved(run, section, lines[i].start);
      for (let k = i; k < Math.min(lines.length, i + 1 + AHEAD); k++) void this.clip(script, k).catch(() => {});
      if (i >= lines.length - 2) void this.prefetch(section + 1);
      this.set({ section, line: i, lines: lines.length, waiting: true, time: undefined });
      const pcm = await this.clip(script, i);
      if (run !== this.run) throw new Stopped();
      this.clips.delete(this.clipKey(section, i));
      this.takes.get(`${this.state.voice}:${section}`)?.lines.delete(i);
      this.speak(section, lines[i]);
      this.set({ waiting: false });
      await this.playClip(concat(pcm, silence(lines[i].pause)));
    }
  }

  /** Plays one spoken sentence; resolves when it ends. Waits while paused. */
  private playClip(pcm: Float32Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = this.audio;
      const url = URL.createObjectURL(wav(pcm));
      const done = (error?: Error) => {
        audio.removeEventListener("ended", onEnded);
        URL.revokeObjectURL(url);
        this.interrupt = null;
        this.onResume = null;
        if (error) reject(error);
        else resolve();
      };
      const onEnded = () => done();
      this.interrupt = () => done(new Stopped());
      const start = () => {
        this.onResume = null;
        audio.src = url;
        audio.playbackRate = this.state.rate;
        audio.addEventListener("ended", onEnded);
        if (this.state.status !== "playing") this.set({ status: "playing" });
        this.updateSession();
        this.begin(done);
      };
      // Paused while this sentence was being made: start it when play is pressed.
      if (this.state.status === "paused") this.onResume = start;
      else start();
    });
  }

  /**
   * Starts the audio. A start the browser blocks (no recent click) pauses instead, so pressing play
   * carries on; one cut short by a pause or a skip is nothing to report.
   */
  private begin(fail: (error: Error) => void) {
    this.audio.play().catch((error: Error) => {
      if (error.name === "AbortError") return;
      if (error.name !== "NotAllowedError") return fail(error);
      this.onResume = () => {
        this.onResume = null;
        this.begin(fail);
      };
      this.set({ status: "paused" });
    });
  }

  // ---- making speech ------------------------------------------------------------------------

  private serverUp(): Promise<boolean> {
    return (this.server ??= serverUp());
  }

  private ensureVoice(): Voice {
    if (!this.voice) {
      this.voice = new Voice(
        (loaded, total) => this.set({ download: { loaded, total } }),
        this.serverUp(),
        (engine) => this.useEngine(engine),
      );
      this.useEngine(this.voice.engine);
    }
    return this.voice;
  }

  private useEngine(engine: Promise<Voicing>) {
    engine.then(
      (engine) => this.set({ engine, download: undefined }),
      (error: Error) => {
        this.voice?.terminate();
        this.voice = null;
        this.set({ status: "error", error: `The voice couldn't load: ${error.message}`, download: undefined });
      },
    );
  }

  /** A chapter's sentences, read from its document as the book stores it (not as it's laid out). */
  private script(section: number): Promise<Script> {
    let script = this.scripts.get(section);
    if (!script) {
      script = (async () => {
        const doc = await this.view.book.sections[section].createDocument();
        const speech = speechText(doc, this.book.paper);
        const blocks = speech.blocks.map((b) => speech.text.slice(b.start, b.end));
        const splits = blocks.length ? await this.ensureVoice().split(blocks) : [];
        const lines: Line[] = [];
        speech.blocks.forEach((block, b) => {
          const sentences = splits[b] ?? [];
          sentences.forEach(([s, e], j) => {
            const start = block.start + s;
            const end = block.start + e;
            const text = speech.text.slice(start, end);
            const say = spoken(text, this.book.paper);
            if (!sayable(say)) return;
            const last = j === sentences.length - 1;
            lines.push({ start, end, text, say, pause: last ? (block.heading ? PAUSE.heading : PAUSE.paragraph) : PAUSE.sentence });
          });
        });
        return { section, lines };
      })();
      script.catch(() => this.scripts.delete(section));
      this.scripts.set(section, script);
    }
    return script;
  }

  private clipKey = (section: number, line: number) => `${this.state.voice}:${section}:${line}`;

  /** A sentence's audio: from the chapter's recording when it's being made, else spoken on its own. */
  private clip(script: Script, line: number): Promise<Float32Array> {
    const key = this.clipKey(script.section, line);
    const take = this.takes.get(`${this.state.voice}:${script.section}`);
    const fromTake = take?.lines.get(line);
    if (fromTake) return fromTake;
    let clip = this.clips.get(key);
    if (!clip) {
      const voice = this.state.voice;
      clip = this.ensureVoice().speak(
        script.lines[line].say,
        voice,
        () => 0,
        () => this.clips.has(key),
      );
      clip.catch(() => this.clips.delete(key));
      this.clips.set(key, clip);
    }
    return clip;
  }

  /** Gets the next chapter's first sentences ready, near the end of this one. */
  private async prefetch(section: number) {
    while (section < this.book.sections.length && !this.readable(section)) section++;
    if (section >= this.book.sections.length) return;
    if (this.savedSections.has(section)) {
      void this.fetchSaved(section).catch(() => {});
      return;
    }
    const script = await this.script(section).catch(() => null);
    const engine = await this.voice?.engine.catch(() => null);
    if (!script || this.state.status === "off") return;
    // On a GPU the next chapter is recorded, which makes its first sentences too; the GPU server saves it.
    if (engine?.device === "webgpu") return void this.record(script);
    if (engine?.device === "server") void this.sendChapters([section], true).catch(() => {});
    for (let k = 0; k < Math.min(2, script.lines.length); k++) void this.clip(script, k).catch(() => {});
  }

  /** Records a chapter in the current voice and saves it (or joins the recording already under way). */
  private record(script: Script): Take {
    const { section } = script;
    const voiceId = this.state.voice;
    const key = `${voiceId}:${section}`;
    const existing = this.takes.get(key);
    if (existing) return existing;
    const voice = this.ensureVoice();
    // Urgent while it's the chapter being listened to.
    const priority = () => (this.state.status !== "off" && this.state.section === section ? 0 : 1);
    const take: Take = { section, voice: voiceId, cancelled: false, lines: new Map(), done: Promise.resolve(), made: 0, total: script.lines.length, started: Date.now() };
    // Every sentence is asked for now, in order; the queue makes them one at a time. Playback
    // takes them from `take.lines` (and drops them once played); the recording keeps its own list.
    const pending: (Promise<Float32Array> | null)[] = script.lines.map((line) => {
      const pcm = voice.speak(line.say, voiceId, priority, () => !take.cancelled);
      pcm.catch(() => {});
      return pcm;
    });
    pending.forEach((pcm, i) => take.lines.set(i, pcm!));

    take.done = (async () => {
      const tag = `${this.book.id}:${key}`;
      await voice.encodeBegin(tag);
      const timings: AudioLine[] = [];
      let t = 0;
      for (let i = 0; i < script.lines.length; i++) {
        const line = script.lines[i];
        // A sentence the voice fails on is tried once more before the chapter is given up.
        const pcm = await pending[i]!.catch((error: Error) => {
          if (error instanceof Stopped || take.cancelled) throw error;
          return voice.speak(line.say, voiceId, priority, () => !take.cancelled);
        });
        pending[i] = null;
        if (take.cancelled) throw new Stopped();
        // Not wanted for playback (heard already, or nobody's listening here): let it go.
        if (!(this.state.status !== "off" && this.state.section === section && this.state.line <= i)) take.lines.delete(i);
        timings.push({ start: line.start, end: line.end, text: line.text, t0: round(t), t1: round(t + pcm.length / SAMPLE_RATE) });
        t += (pcm.length + Math.round(SAMPLE_RATE * line.pause)) / SAMPLE_RATE;
        await voice.encodeAdd(tag, concat(pcm, silence(line.pause)));
        take.made = i + 1;
        this.showTake(take);
      }
      const mp3 = await voice.encodeEnd(tag);
      if (take.cancelled) throw new Stopped();
      await this.upload(section, voiceId, mp3, round(t), timings);
    })();
    take.done
      .catch((error: Error) => {
        if (!(error instanceof Stopped)) console.warn(`Couldn't save chapter ${section + 1}:`, error.message);
      })
      .finally(() => {
        if (this.takes.get(key) === take) this.takes.delete(key);
      });
    this.takes.set(key, take);
    return take;
  }

  /** Shows how far the chapter being saved has got, when it's the one "save the whole book" is on. */
  private showTake(take: Take) {
    const saving = this.state.saving;
    if (!saving || saving.section !== take.section || take.voice !== this.state.voice) return;
    const { made, total } = take;
    // Time left, from the pace so far; only once there's enough of it to go on.
    const elapsed = (Date.now() - take.started) / 1000;
    const left = made >= 10 && elapsed > 30 ? (elapsed / made) * (total - made) : undefined;
    this.set({ saving: { section: take.section, made, total, left } });
  }

  private async upload(section: number, voice: string, mp3: Uint8Array, duration: number, lines: AudioLine[]) {
    const base = `/api/books/${this.book.id}/audio/${section}`;
    const json = { "content-type": "application/json" };
    const start = await fetch(base, { method: "POST", headers: json, body: JSON.stringify({ voice, bytes: mp3.byteLength }) });
    const { uploadUrl, error } = (await start.json()) as { uploadUrl?: string; error?: string };
    if (!start.ok || !uploadUrl) throw new Error(error ?? "Couldn't start saving.");
    const put = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": "audio/mpeg" }, body: mp3 as BodyInit });
    if (!put.ok) throw new Error(`Storage refused the audio (${put.status}).`);
    const done = await fetch(base, { method: "PUT", headers: json, body: JSON.stringify({ voice, bytes: mp3.byteLength, duration, lines }) });
    if (!done.ok) throw new Error(((await done.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't save.");
    if (voice === this.state.voice) {
      this.savedSections.set(section, duration);
      this.set({ saved: this.savedCount() });
    }
  }

  // ---- saved chapters -----------------------------------------------------------------------

  private loadedVoice: string | null = null;

  /**
   * Learns which chapters are saved in the current voice (again, with `fresh`). If that can't be
   * learned, none are, and it's asked again next time.
   */
  private async loadSaved(fresh = false) {
    const voice = this.state.voice;
    if (this.loadedVoice === voice && !fresh) return;
    const res = await fetch(`/api/books/${this.book.id}/audio?voice=${voice}`).catch(() => null);
    if (!res?.ok) {
      console.warn("Couldn't check for saved chapters; reading aloud without them.");
      return;
    }
    const { sections } = (await res.json()) as { sections: { section: number; duration: number }[] };
    if (voice !== this.state.voice) return;
    this.savedSections = new Map(sections.map((s) => [s.section, s.duration]));
    this.loadedVoice = voice;
    this.set({ saved: this.savedCount() });
  }

  /** Learns which chapters are saved, and follows any the GPU server is saving, without starting to read (for the player's menu). */
  refresh() {
    void this.loadSaved().catch(() => {});
    // Chapters the GPU server is still saving: asked for before a reload, or in another tab.
    void this.serverUp().then((up) => {
      if (!up) return;
      if (!this.state.engine) this.set({ engine: { device: "server" } });
      void this.watch();
    });
  }

  private savedCount() {
    return [...this.savedSections.keys()].filter((s) => this.readable(s)).length;
  }

  private fetchSaved(section: number): Promise<Saved> {
    const cached = this.savedCache.get(section);
    if (cached) return cached;
    const voice = this.state.voice;
    const saved = fetch(`/api/books/${this.book.id}/audio/${section}?voice=${voice}`).then(async (res) => {
      if (!res.ok) throw new Error("Couldn't load the saved chapter.");
      return { ...((await res.json()) as AudioSection & { url: string }), fetchedAt: Date.now() };
    });
    this.savedCache.set(section, saved);
    saved.then(
      () => setTimeout(() => this.savedCache.get(section) === saved && this.savedCache.delete(section), URL_FRESH_MS),
      () => this.savedCache.delete(section),
    );
    return saved;
  }

  // ---- the page -----------------------------------------------------------------------------

  /** Whether a section has anything to read: in the reading order, with text, and not a paper's references. */
  private readable(section: number): boolean {
    const info = this.book.sections[section];
    const spine = this.view.book.sections[section];
    if (!info || !spine || spine.linear === "no" || info.chars < 1) return false;
    return !(this.book.paper && /^(references|bibliography)$/i.test(info.title.trim()));
  }

  private textOf(doc: Document): SpeechText {
    let text = this.texts.get(doc);
    if (!text) {
      text = speechText(doc, this.book.paper);
      this.texts.set(doc, text);
    }
    return text;
  }

  /** The chapter on screen, and where the page starts in its text. */
  private visibleOffset(): { section: number; offset: number } {
    const range = this.view.lastLocation?.range;
    const doc = range?.startContainer.ownerDocument;
    const content = this.view.renderer.getContents().find((c) => c.doc === doc);
    if (!range || !doc || !content) return { section: this.view.lastLocation?.section?.current ?? 0, offset: 0 };
    return { section: content.index, offset: offsetAt(this.textOf(doc), range.startContainer, range.startOffset) };
  }

  /** Where sentence `line` of a chapter starts, or null when there's no such sentence. */
  private async lineOffset(section: number, line: number): Promise<number | null> {
    if (line < 0) return null;
    if (this.savedSections.has(section)) {
      const saved = await this.fetchSaved(section);
      return saved.lines[line]?.start ?? null;
    }
    const script = await this.script(section);
    return script.lines[line]?.start ?? null;
  }

  private isRendered(range: Range) {
    return this.view.renderer.getContents().some((c) => c.doc === range.startContainer.ownerDocument);
  }

  /** Whether the start of a range is on the page shown. */
  private onPage(range: Range | null): boolean {
    const shown = this.view.lastLocation?.range;
    if (!range || !shown || shown.startContainer.ownerDocument !== range.startContainer.ownerDocument) return false;
    try {
      return shown.comparePoint(range.startContainer, range.startOffset) === 0;
    } catch {
      return false;
    }
  }

  /** A new sentence is being read: highlight it, and turn the page to it if the reader was following along. */
  private speak(section: number, line: { start: number; end: number; text: string }) {
    const following = !this.reading || this.state.away === false;
    this.reading = { section, start: line.start, end: line.end, text: line.text };
    void this.show(following);
    this.updateSession();
  }

  /** Highlights the sentence being read, where its chapter is on screen; turns the page when `turn`. */
  private async show(turn = true) {
    const reading = this.reading;
    if (!reading) return;
    let content = this.view.renderer.getContents().find((c) => c.index === reading.section);
    if (!content && turn) {
      await this.view.goTo(reading.section);
      if (this.reading !== reading) return;
      content = this.view.renderer.getContents().find((c) => c.index === reading.section);
    }
    if (!content) {
      this.highlight(null);
      this.set({ away: true });
      return;
    }
    const text = this.textOf(content.doc);
    const at = locate(text, reading, Math.max(0, reading.start - 200));
    const range = at && rangeFor(text, at[0], at[1]);
    this.highlight(range);
    if (range && turn && !this.onPage(range)) await this.view.renderer.scrollToAnchor(range);
    this.set({ away: !this.onPage(range) });
  }

  private highlight(range: Range | null) {
    for (const { doc } of this.view.renderer.getContents()) {
      const highlights = (doc.defaultView as (Window & typeof globalThis) | null)?.CSS?.highlights;
      highlights?.delete("narration");
    }
    this.range = range;
    if (!range) return;
    const win = range.startContainer.ownerDocument?.defaultView as (Window & typeof globalThis) | null;
    if (win?.CSS?.highlights && win.Highlight) win.CSS.highlights.set("narration", new win.Highlight(range));
  }

  private onRelocate = () => {
    if (this.reading && this.state.status !== "off") this.set({ away: !this.onPage(this.range) });
  };

  /** A chapter laid out again (or newly shown): put the highlight back on it. */
  private onLoad = (event: Event) => {
    const { index } = (event as CustomEvent<{ index: number }>).detail;
    if (this.reading?.section === index) requestAnimationFrame(() => void this.show(false));
  };

  // ---- the lock screen and headphone buttons -------------------------------------------------

  private updateSession() {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    // The contents entry for the page shown, when that's the one being read; else the file's title.
    const here = this.view.lastLocation;
    const chapter =
      (here?.section?.current === this.state.section && here.tocItem?.label?.trim()) ||
      this.book.sections[this.state.section]?.title ||
      `Chapter ${this.state.section + 1}`;
    if (session.metadata?.title !== chapter) {
      session.metadata = new MediaMetadata({
        title: chapter,
        artist: this.book.author,
        album: this.book.title,
        artwork: [{ src: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
      });
      session.setActionHandler("play", () => this.resume());
      session.setActionHandler("pause", () => this.pause());
      session.setActionHandler("stop", () => this.stop());
      session.setActionHandler("seekbackward", () => this.skip(-1));
      session.setActionHandler("seekforward", () => this.skip(1));
      session.setActionHandler("previoustrack", () => this.chapter(-1));
      session.setActionHandler("nexttrack", () => this.chapter(1));
    }
    session.playbackState = this.state.status === "paused" ? "paused" : "playing";
  }

  /** Plays a moment of silence, inside the click that started reading, so later audio is allowed to start. */
  private unlock() {
    this.audio.src = URL.createObjectURL(wav(silence(0.05)));
    void this.audio.play().catch(() => {});
  }

  private savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ voice: this.state.voice, rate: this.state.rate }));
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;
