/// <reference lib="webworker" />
/**
 * The narrator's voice: Kokoro (https://huggingface.co/hexgrad/Kokoro-82M, Apache-2.0), run in
 * the browser with kokoro-js, off the main thread. It splits text into sentences, speaks them, and
 * encodes chapters as MP3, as they're spoken, for storage. narrator.ts asks for one sentence at a
 * time, so it can always put what's about to play first.
 */
import { Mp3Encoder } from "@breezystack/lamejs";
import { env as hf } from "@huggingface/transformers";
import { env, KokoroTTS, TextSplitterStream } from "kokoro-js";

/** Kokoro speaks at 24 kHz (narrator.ts has the same constant; importing it would bundle all of this). */
const SAMPLE_RATE = 24_000;
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
/** Kokoro reads at most ~510 phonemes at once; longer sentences are spoken in pieces. */
const MAX_CHUNK = 300;
const CHUNK_GAP = Math.round(SAMPLE_RATE * 0.06);
const MP3_KBPS = 64;

export type Request =
  | { id: number; type: "load" }
  | { id: number; type: "split"; texts: string[] }
  | { id: number; type: "speak"; text: string; voice: string }
  /** A chapter's MP3 is made as it's spoken: begin, add each sentence's audio in order, end. */
  | { id: number; type: "encode-begin"; key: string }
  | { id: number; type: "encode-add"; key: string; pcm: Float32Array }
  | { id: number; type: "encode-end"; key: string };

export type Reply =
  | { id: number; result: unknown }
  | { id: number; error: string }
  | { type: "progress"; loaded: number; total: number };

/** Where the model runs: the GPU, at full precision, or else the CPU, with the smaller 8-bit model. */
export type Engine = { device: "webgpu" | "wasm"; dtype: "fp32" | "q8" };

// ONNX Runtime's WebAssembly comes from this site (scripts/copy-ort.ts), not a CDN.
env.wasmPaths = "/ort/";
// It warns, as errors, that some steps run on the CPU on purpose; only real errors are worth showing.
hf.backends.onnx.logLevel = "error";

let tts: Promise<{ tts: KokoroTTS; engine: Engine }> | null = null;

/** The model, loaded once. A failed load is tried again on the next request. */
const model = () =>
  (tts ??= load().catch((error: unknown) => {
    tts = null;
    throw error;
  }));

async function load() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  const engine: Engine = adapter ? { device: "webgpu", dtype: "fp32" } : { device: "wasm", dtype: "q8" };
  // Each file reports its own progress; the total is summed across them.
  const files = new Map<string, { loaded: number; total: number }>();
  const model = await KokoroTTS.from_pretrained(MODEL, {
    ...engine,
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== "progress" || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ type: "progress", loaded, total });
    },
  });
  return { tts: model, engine };
}

/** Each text's sentences, as [start, end) offsets into it. */
function split(texts: string[]): [number, number][][] {
  return texts.map((text) => {
    const splitter = new TextSplitterStream();
    splitter.push(text);
    splitter.close();
    const out: [number, number][] = [];
    let at = 0;
    for (const sentence of splitter.sentences) {
      const start = text.indexOf(sentence, at);
      if (start < 0) continue;
      out.push([start, start + sentence.length]);
      at = start + sentence.length;
    }
    return out;
  });
}

/** A long sentence in pieces of at most MAX_CHUNK characters, broken at clauses, else at spaces. */
function chunks(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHUNK) {
    const head = rest.slice(0, MAX_CHUNK);
    let cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "), head.lastIndexOf(": "), head.lastIndexOf(" — "));
    if (cut < MAX_CHUNK / 3) cut = head.lastIndexOf(" ");
    if (cut < 1) cut = MAX_CHUNK;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

async function speak(text: string, voice: string): Promise<Float32Array> {
  const { tts: voiceModel } = await model();
  const parts: Float32Array[] = [];
  for (const piece of chunks(text)) {
    const audio = await voiceModel.generate(piece, { voice: voice as never });
    parts.push(audio.audio as Float32Array);
  }
  const length = parts.reduce((n, p) => n + p.length, 0) + CHUNK_GAP * (parts.length - 1);
  const out = new Float32Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length + CHUNK_GAP;
  }
  return out;
}

/** MP3 encoders for chapters being made, and what each has produced so far. */
const encoders = new Map<string, { encoder: Mp3Encoder; out: Uint8Array[] }>();

function encodeAdd(key: string, pcm: Float32Array) {
  const take = encoders.get(key);
  if (!take) throw new Error("No such recording.");
  const samples = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  // lamejs reuses its output buffer, so each piece is copied out.
  take.out.push(take.encoder.encodeBuffer(samples).slice());
}

function encodeEnd(key: string): Uint8Array {
  const take = encoders.get(key);
  if (!take) throw new Error("No such recording.");
  encoders.delete(key);
  take.out.push(take.encoder.flush().slice());
  const bytes = new Uint8Array(take.out.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of take.out) {
    bytes.set(b, at);
    at += b.length;
  }
  return bytes;
}

function post(reply: Reply, transfer: Transferable[] = []) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply, transfer);
}

self.addEventListener("message", async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.type === "load") {
      post({ id: request.id, result: (await model()).engine });
    } else if (request.type === "split") {
      post({ id: request.id, result: split(request.texts) });
    } else if (request.type === "speak") {
      const audio = await speak(request.text, request.voice);
      post({ id: request.id, result: audio }, [audio.buffer]);
    } else if (request.type === "encode-begin") {
      encoders.set(request.key, { encoder: new Mp3Encoder(1, SAMPLE_RATE, MP3_KBPS), out: [] });
      post({ id: request.id, result: null });
    } else if (request.type === "encode-add") {
      encodeAdd(request.key, request.pcm);
      post({ id: request.id, result: null });
    } else {
      const mp3 = encodeEnd(request.key);
      post({ id: request.id, result: mp3 }, [mp3.buffer]);
    }
  } catch (error) {
    post({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
});
