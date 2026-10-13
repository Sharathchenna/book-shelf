"""
The narrator's GPU voice: Kokoro-82M (the same model and voices the browser runs) on CUDA.

It listens on localhost only. A Cloudflare Tunnel connects it to the site's Worker through
Workers VPC, which is the only way to reach it: there is no public hostname and no open port.
The Worker asks it for two things:

- POST /speak: one sentence, spoken now, as 16-bit PCM. For listening to a chapter that isn't
  saved yet, until it is.
- POST /jobs: chapters to save. Each is spoken here, encoded to MP3 and saved to the site with
  its sentences' timings, through the same routes the browser saves with (narrator.ts), signed
  with the narrator token. GET /jobs?book= reports progress; DELETE /jobs?book= stops them.

The GPU is shared, so the voice only holds GPU memory while it's working. This process never
touches the GPU; the speaking happens in voice processes that it starts when there's work and
that exit when there isn't: one for listening (started by /health, when the reader opens, and
gone after LIVE_IDLE seconds unused), and up to WORKERS saving chapters side by side (gone
WORKER_IDLE seconds after the last chapter). One sentence at a time leaves an A100 mostly idle,
so several processes are what keep it busy. Each is capped at GPU_MB, and none starts unless
the GPU has that much free beyond GPU_RESERVE_MB, which is left for whatever else runs there.

Chapters in Fish Audio's voices (fi_*) are saved here too, but spoken by Fish's API rather
than the GPU: a thread asks Fish for FISH_AT_ONCE sentences at a time (its free tier allows five
at once per account, and the reader may be using two), with the key in fish-key. They need no
GPU memory at all.

Jobs waiting are kept in jobs/ and picked up again after a restart. Setup is in the README
(On a GPU server); narrator.service and narrator-tunnel.service keep it running.
"""

import json
import logging
import multiprocessing as mp
import os
import queue
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import lameenc
import numpy as np

HOME = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8880"))
SITE = os.environ.get("SITE_URL", "https://read.sharathchenna.com").rstrip("/")
TOKEN = (HOME / "site-token").read_text().strip()
JOBS = HOME / "jobs"
REPO = "hexgrad/Kokoro-82M"

WORKERS = int(os.environ.get("WORKERS", "4"))
GPU_MB = int(os.environ.get("GPU_MB", "1536"))
GPU_RESERVE_MB = int(os.environ.get("GPU_RESERVE_MB", "1024"))
LIVE_IDLE = int(os.environ.get("LIVE_IDLE", "600"))
WORKER_IDLE = int(os.environ.get("WORKER_IDLE", "60"))
# A saving process that reports nothing for this long is stuck: it's stopped, and its chapter
# retried. One that takes longer than LOAD to start is stopped too.
STALL = 180
LOAD = 300
# What CUDA itself takes in each process, besides the memory PyTorch is capped at.
CUDA_CONTEXT_MB = 512
RETRIES = 2

# The same as narrator.ts and narrator.worker.ts, so a chapter saved here plays like one saved there.
SAMPLE_RATE = 24_000
MP3_KBPS = 64
CHUNK_GAP = round(SAMPLE_RATE * 0.06)
# Saving speaks several sentences in one pass, up to this many phonemes (Kokoro takes 510): one
# sentence at a time leaves the GPU mostly waiting. Each sentence is cut back out of the audio.
GROUP = 500
VOICES = {"af_heart", "af_bella", "bf_emma", "am_michael", "bm_george"}
# Fish Audio's voices (lib/voices.ts), by the reference id its API takes, and the key for it.
FISH = {"fi_ethan": "536d3a5e000945adb7038665781a4aca", "fi_adrian": "bf322df2096a46f18c579d0baa36f41d"}
FISH_KEY = (HOME / "fish-key").read_text().strip() if (HOME / "fish-key").exists() else ""
FISH_AT_ONCE = int(os.environ.get("FISH_AT_ONCE", "3"))
# Sentences asked for ahead of the one being encoded, so a slow one doesn't hold up the rest.
FISH_AHEAD = 12
# Waits before asking Fish again when it's busy or failed, in seconds.
FISH_RETRIES = [2, 4, 8, 15, 30, 60]
BOOK_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(processName)s %(message)s")
log = logging.getLogger("narrator")


def pcm16(audio: np.ndarray) -> bytes:
    return (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()


def site(method: str, path: str, body=None, raw: bytes | None = None, content_type="application/json", absolute=False):
    """A request to the site (or, for an upload, to storage), retried a few times."""
    url = path if absolute else f"{SITE}{path}"
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {"content-type": content_type, "user-agent": "book-shelf-narrator/1"}
    if not absolute:
        headers["authorization"] = f"Bearer {TOKEN}"
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(request, timeout=300) as res:
                text = res.read()
                return json.loads(text) if text and res.headers.get_content_type() == "application/json" else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:300]
            if error.code < 500 or attempt == 3:
                raise RuntimeError(f"{method} {path.split('?')[0]}: {error.code} {detail}") from None
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == 3:
                raise RuntimeError(f"{method} {path.split('?')[0]}: {error}") from None
        time.sleep(2**attempt)


# ---- a voice process -------------------------------------------------------------------------


class Cancelled(Exception):
    pass


def voice_process(wid: str, inbox, events, cancel):
    """
    Loads Kokoro on the GPU, then speaks what it's given until there's nothing for a while, and
    exits, which gives the GPU its memory back. "live" speaks sentences; the others save chapters.
    """
    import torch
    from kokoro import KModel, KPipeline

    # Many of these run at once: a few CPU threads each is plenty for the parts on the CPU.
    torch.set_num_threads(2)
    total = torch.cuda.get_device_properties(0).total_memory
    torch.cuda.set_per_process_memory_fraction(min(1.0, GPU_MB * 2**20 / total))
    model = KModel(repo_id=REPO).to("cuda").eval()
    # A pronunciation pipeline per accent, American (a) and British (b), and the same without the model.
    pipelines = {lang: KPipeline(lang_code=lang, repo_id=REPO, model=model) for lang in "ab"}
    g2p = {lang: KPipeline(lang_code=lang, repo_id=REPO, model=False) for lang in "ab"}
    tokens = lambda ps: sum(1 for c in ps if c in model.vocab)  # noqa: E731 - what the model reads of a phoneme string

    def speak(text: str, voice: str) -> np.ndarray:
        """A sentence's audio at 24 kHz. Kokoro splits a long one into pieces, joined with a short gap."""
        with torch.inference_mode():
            parts = [r.audio.cpu().numpy() for r in pipelines[voice[0]](text, voice=voice, split_pattern=None) if r.audio is not None]
        if not parts:
            return np.zeros(0, dtype=np.float32)
        gap = np.zeros(CHUNK_GAP, dtype=np.float32)
        joined = [parts[0]]
        for part in parts[1:]:
            joined += [gap, part]
        return np.concatenate(joined).astype(np.float32)

    def speak_all(says: list[str], voice: str):
        """
        Each text's speech and the pause the voice leaves after it, in order: several sentences
        to a pass, cut apart where each one's phonemes end (the model reports how long it spends
        on each). A text too long for one pass is spoken in pieces, joined.
        """
        lang = voice[0]
        pack = pipelines[lang].load_voice(voice).to("cuda")
        pieces = [(i, r.phonemes) for i, say in enumerate(says) for r in g2p[lang](say, split_pattern=None) if r.phonemes]
        last = {i: k for k, (i, _) in enumerate(pieces)}
        groups, current = [], []
        for piece in pieces:
            if current and len(" ".join(ps for _, ps in current + [piece])) > GROUP:
                groups.append(current)
                current = []
            current.append(piece)
        if current:
            groups.append(current)

        speech: dict[int, list[np.ndarray]] = {}
        gaps: dict[int, np.ndarray] = {}
        emitted, done = 0, -1
        for group in groups:
            joined = " ".join(ps for _, ps in group)
            with torch.inference_mode():
                out = model(joined, pack[len(joined) - 1], return_output=True)
            audio = out.audio.cpu().numpy().astype(np.float32)
            frames = np.concatenate([[0], np.cumsum(out.pred_dur.cpu().numpy())])
            per_frame = len(audio) / frames[-1]
            at = lambda token: round(frames[token] * per_frame)  # noqa: E731 - where a token's speech starts
            token = 1  # after the start-of-text token
            for k, (i, ps) in enumerate(group):
                end = token + tokens(ps)
                # The space after it, and for the last piece the end-of-text token, are its pause.
                after = end + (tokens(" ") if k < len(group) - 1 else 1)
                start_sample = 0 if k == 0 else at(token)
                speech.setdefault(i, []).append(audio[start_sample : at(end)])
                gaps[i] = audio[at(end) : at(after)] if k < len(group) - 1 else audio[at(end) :]
                token = after
                done += 1
            # Texts whose pieces are all spoken, in order. Texts with nothing to say are silent.
            while emitted < len(says) and (emitted not in last or last[emitted] <= done):
                parts = speech.pop(emitted, [])
                yield emitted, (np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)), gaps.pop(emitted, np.zeros(0, dtype=np.float32))
                emitted += 1
        while emitted < len(says):
            yield emitted, np.zeros(0, dtype=np.float32), np.zeros(0, dtype=np.float32)
            emitted += 1

    speak("Ready.", "af_heart")
    events.put((wid, "ready", None))
    while True:
        try:
            task = inbox.get(timeout=LIVE_IDLE if wid == "live" else WORKER_IDLE)
        except queue.Empty:
            return
        if wid == "live":
            rid, text, voice = task
            try:
                events.put((wid, "spoken", (rid, pcm16(speak(text, voice)))))
            except Exception as error:  # noqa: BLE001 - reported to the request waiting for it
                log.warning("couldn't speak: %s", error)
                events.put((wid, "spoken", (rid, None)))
            continue
        try:
            make(task, speak_all, lambda made: events.put((wid, "progress", (task["key"], made))), cancel)
            events.put((wid, "done", task["key"]))
        except Cancelled:
            events.put((wid, "cancelled", task["key"]))
        except Exception as error:  # noqa: BLE001 - one chapter failing mustn't stop the rest
            events.put((wid, "failed", (task["key"], str(error))))


def make(task: dict, speak_all, progress, cancel):
    """Speaks a chapter, encodes it as the browser does, and saves it with its sentences' timings."""
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(MP3_KBPS)
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    mp3 = bytearray()
    timings = []
    t = 0.0
    lines = task["lines"]
    for i, audio, gap in speak_all([line["say"] for line in lines], task["voice"]):
        if cancel.is_set():
            raise Cancelled()
        line = lines[i]
        timings.append({"start": line["start"], "end": line["end"], "text": line["text"], "t0": round(t, 3), "t1": round(t + len(audio) / SAMPLE_RATE, 3)})
        # The pause the reader asks for after it (longer after a paragraph or heading), of which the voice left `gap`.
        rest = np.zeros(max(0, round(SAMPLE_RATE * float(line.get("pause", 0))) - len(gap)), dtype=np.float32)
        t += (len(audio) + len(gap) + len(rest)) / SAMPLE_RATE
        mp3 += encoder.encode(pcm16(np.concatenate([audio, gap, rest])))
        if (i + 1) % 10 == 0 or i + 1 == len(lines):
            progress(i + 1)
    mp3 += encoder.flush()

    progress(-1)  # saving
    base = f"/api/books/{task['book']}/audio/{task['section']}"
    start = site("POST", base, {"voice": task["voice"], "bytes": len(mp3)})
    # A presigned storage URL, or (without R2) one on the site carrying its own token.
    upload = urllib.parse.urljoin(SITE + "/", start["uploadUrl"])
    site("PUT", upload, raw=bytes(mp3), content_type="audio/mpeg", absolute=True)
    site("PUT", base, {"voice": task["voice"], "bytes": len(mp3), "duration": round(t, 3), "lines": timings})


# ---- Fish Audio's voices ---------------------------------------------------------------------


def fish_say(text: str, voice: str) -> np.ndarray:
    """A sentence in a Fish voice, at 24 kHz. Busy (too many at once) and failures are waited out a few times."""
    # The reader sends it ready: the book's own [brackets] as parentheses, and directions in brackets.
    # Only <|…|>, which S2 takes as speaker turns, is defused here.
    text = text.replace("<|", "<").replace("|>", ">")
    body = json.dumps({"text": text, "reference_id": FISH[voice], "format": "pcm", "sample_rate": SAMPLE_RATE, "latency": "normal"}).encode()
    headers = {"authorization": f"Bearer {FISH_KEY}", "content-type": "application/json", "model": "s2.1-pro-free"}
    for attempt in range(len(FISH_RETRIES) + 1):
        try:
            request = urllib.request.Request("https://api.fish.audio/v1/tts", data=body, headers=headers)
            with urllib.request.urlopen(request, timeout=180) as res:
                pcm = res.read()
            return np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype="<i2").astype(np.float32) / 32768
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:200]
            if (error.code != 429 and error.code < 500) or attempt == len(FISH_RETRIES):
                raise RuntimeError(f"Fish Audio: {error.code} {detail}") from None
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == len(FISH_RETRIES):
                raise RuntimeError(f"Fish Audio: {error}") from None
        time.sleep(FISH_RETRIES[attempt])
    raise AssertionError("unreachable")


def fish_speak_all(says: list[str], voice: str):
    """Like a voice process's speak_all: each text's speech, in order, with no gap of its own (make() adds the pause)."""
    nothing = np.zeros(0, dtype=np.float32)
    pool = ThreadPoolExecutor(FISH_AT_ONCE)
    try:
        asked: dict[int, object] = {}
        for i in range(len(says)):
            for k in range(i, min(len(says), i + FISH_AHEAD)):
                if k not in asked:
                    asked[k] = pool.submit(fish_say, says[k], voice)
            yield i, asked.pop(i).result(), nothing
    finally:
        # Stopped or failed partway: sentences not started yet aren't asked for.
        pool.shutdown(wait=False, cancel_futures=True)


def fish_saver():
    """Saves chapters in Fish voices, one at a time, urgent ones first."""
    while True:
        with changed:
            queued = [j for j in jobs.values() if j.state == "queued" and j.voice in FISH]
            if not queued:
                changed.wait(5)
                continue
            job = next((j for j in reversed(queued) if j.urgent), queued[0])
            job.state, job.made, job.started = "making", 0, time.time()
            job.stop.clear()

        def progress(made: int, job=job):
            with changed:
                job.made, job.state = (job.made, "saving") if made < 0 else (made, job.state)

        try:
            make(job.task(), fish_speak_all, progress, job.stop)
            state, error = "done", ""
        except Cancelled:
            state, error = "cancelled", ""
        except Exception as e:  # noqa: BLE001 - one chapter failing mustn't stop the rest
            state, error = "failed", str(e)
        with changed:
            job.tries += 1
            if state == "failed" and job.tries <= RETRIES and not job.cancelled:
                # Fish was down for minutes: the chapter waits its turn again.
                log.warning("retrying %s: %s", job.key, error)
                job.state, job.made = "queued", 0
                changed.notify_all()
                continue
            finish(job, state, error)
            for k, old in list(jobs.items()):
                if old.state in ("done", "failed", "cancelled") and time.time() - old.started > 3600:
                    del jobs[k]
            changed.notify_all()


# ---- the voice processes, from here ----------------------------------------------------------

ctx = mp.get_context("spawn")


def nvidia_smi(query: str) -> list[list[int]]:
    out = subprocess.run(["nvidia-smi", query, "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10, check=True)
    return [[int(x) for x in line.split(",")] for line in out.stdout.strip().splitlines() if line.strip()]


class Voice:
    """A voice process, and what it's doing."""

    count = 0

    def __init__(self, wid: str, events):
        self.wid = wid
        self.inbox = ctx.Queue()
        self.cancel = ctx.Event()
        self.ready = False
        self.job: "Job | None" = None
        self.heard = self.born = time.time()
        self.process = ctx.Process(target=voice_process, args=(wid, self.inbox, events, self.cancel), name=f"voice-{wid}", daemon=True)
        self.process.start()

    def alive(self) -> bool:
        return self.process.is_alive()

    def stop(self):
        self.process.kill()


class Job:
    def __init__(self, book: str, voice: str, section: int, lines: list, urgent: bool):
        self.book, self.voice, self.section, self.lines, self.urgent = book, voice, section, lines, urgent
        self.state = "queued"
        self.made = 0
        self.started = 0.0
        self.error = ""
        self.cancelled = False
        self.tries = 0
        # Stops a Fish chapter partway (a voice process has its own).
        self.stop = threading.Event()

    @property
    def key(self) -> str:
        return f"{self.book}.{self.voice}.{self.section}"

    def task(self) -> dict:
        return {"key": self.key, "book": self.book, "voice": self.voice, "section": self.section, "lines": self.lines}

    def report(self) -> dict:
        out = {"section": self.section, "voice": self.voice, "state": self.state, "made": self.made, "total": len(self.lines)}
        elapsed = time.time() - self.started
        if self.state == "making" and self.made >= 10 and elapsed > 2:
            out["left"] = round(elapsed / self.made * (len(self.lines) - self.made), 1)
        if self.error:
            out["error"] = self.error
        return out


jobs: dict[str, Job] = {}
voices: dict[str, Voice] = {}
changed = threading.Condition()
events = None  # the voice processes' reports, made in main()
spoken: dict[int, list] = {}  # live requests waiting: id -> [threading.Event, pcm]
asked = 0


def save_file(job: Job):
    JOBS.mkdir(exist_ok=True)
    data = {"book": job.book, "voice": job.voice, "section": job.section, "lines": job.lines}
    (JOBS / f"{job.key}.json").write_text(json.dumps(data))


def drop_file(job: Job):
    (JOBS / f"{job.key}.json").unlink(missing_ok=True)


def enqueue(book: str, voice: str, chapters: list, urgent: bool) -> int:
    added = 0
    with changed:
        for chapter in chapters:
            job = Job(book, voice, int(chapter["section"]), chapter["lines"], urgent)
            current = jobs.get(job.key)
            if current and current.state in ("making", "saving"):
                current.urgent = current.urgent or urgent
                continue
            jobs[job.key] = job
            save_file(job)
            added += 1
        changed.notify_all()
    return added


def finish(job: Job, state: str, error: str = ""):
    job.state, job.error = state, error
    drop_file(job)
    log.info("%s %s: %d sentences in %.0fs %s", state, job.key, len(job.lines), time.time() - job.started, error)


def room(more: int) -> bool:
    """
    Whether `more` voice processes fit beside those running. The budget is the GPU's memory less
    what everything else on it uses and GPU_RESERVE_MB, and each process is counted at its
    most: one that's starting, or between chapters, takes more than it holds now.
    """
    try:
        [[total, used]] = nvidia_smi("--query-gpu=memory.total,memory.used")
        apps = nvidia_smi("--query-compute-apps=pid,used_memory")
    except Exception:  # noqa: BLE001 - when in doubt, don't
        return False
    running = [v for v in voices.values() if v.alive()]
    mine = {v.process.pid for v in running}
    others = used - sum(mb for pid, mb in apps if pid in mine)
    return len(running) + more <= (total - others - GPU_RESERVE_MB) // (GPU_MB + CUDA_CONTEXT_MB)


def live_voice() -> Voice | None:
    """The listening voice: started if it isn't running and the GPU has room."""
    with changed:
        live = voices.get("live")
        if live and live.alive():
            return live
        if not room(1):
            return None
        voices["live"] = Voice("live", events)
        return voices["live"]


def speak_live(text: str, voice: str) -> bytes | None:
    global asked
    live = live_voice()
    if not live:
        return None
    with changed:
        asked += 1
        rid = asked
        spoken[rid] = [threading.Event(), None]
    live.inbox.put((rid, text, voice))
    # Long enough for a voice process that's starting to load first.
    spoken[rid][0].wait(90)
    return spoken.pop(rid)[1]


def schedule():
    """Starts saving processes while there are chapters to save, and hands each a chapter as it's free."""
    while True:
        with changed:
            now = time.time()
            for wid, v in list(voices.items()):
                stuck = (v.job and v.ready and now - v.heard > STALL) or (not v.ready and now - v.born > LOAD)
                if stuck:
                    v.stop()
                if v.alive() and not stuck:
                    continue
                del voices[wid]
                job = v.job
                if job and job.state in ("making", "saving"):
                    # The process stopped (or stalled) partway: the chapter goes back in the queue.
                    job.tries += 1
                    if job.cancelled:
                        finish(job, "cancelled")
                    elif job.tries > RETRIES:
                        finish(job, "failed", "the voice process kept stopping")
                    else:
                        log.warning("retrying %s: the voice process %s", job.key, "stalled" if stuck else "stopped")
                        job.state, job.made = "queued", 0

            # Fish's voices are saved by fish_saver(), without the GPU.
            queued = [j for j in jobs.values() if j.state == "queued" and j.voice not in FISH]
            savers = [v for v in voices.values() if v.wid != "live"]
            busy = sum(1 for v in savers if v.job)
            # Saving always leaves room for the listening voice, if it isn't running.
            listening = 0 if "live" in voices else 1
            if len(savers) < min(WORKERS, len(queued) + busy) and room(1 + listening):
                Voice.count += 1
                wid = f"saver{Voice.count}"
                voices[wid] = Voice(wid, events)
                log.info("started %s (%d saving)", wid, len(savers) + 1)

            for v in savers:
                if not (v.ready and v.job is None and v.alive()):
                    continue
                queued = [j for j in jobs.values() if j.state == "queued" and j.voice not in FISH]
                if not queued:
                    break
                # Chapters someone is waiting to listen to first, then the rest in the order asked for.
                job = next((j for j in reversed(queued) if j.urgent), queued[0])
                job.state, job.made, job.started = "making", 0, time.time()
                v.job, v.heard = job, time.time()
                v.cancel.clear()
                v.inbox.put(job.task())
            changed.wait(1)


def listen():
    """What the voice processes report."""
    while True:
        wid, kind, data = events.get()
        with changed:
            v = voices.get(wid)
            if v:
                v.heard = time.time()
            if kind == "ready" and v:
                v.ready = True
            elif kind == "spoken":
                rid, pcm = data
                if rid in spoken:
                    spoken[rid][1] = pcm
                    spoken[rid][0].set()
            elif kind == "progress":
                job = jobs.get(data[0])
                if job:
                    job.made, job.state = (job.made, "saving") if data[1] < 0 else (data[1], job.state)
            elif kind in ("done", "failed", "cancelled"):
                key, error = (data, "") if kind != "failed" else data
                job = jobs.get(key)
                if job:
                    finish(job, kind, error)
                if v:
                    v.job = None
                # Finished chapters are reported for an hour, so the reader sees them through.
                for k, old in list(jobs.items()):
                    if old.state in ("done", "failed", "cancelled") and time.time() - old.started > 3600:
                        del jobs[k]
            changed.notify_all()


def resume():
    """Chapters that were waiting when the service last stopped."""
    for path in sorted(JOBS.glob("*.json")) if JOBS.exists() else []:
        try:
            data = json.loads(path.read_text())
            enqueue(data["book"], data["voice"], [data], urgent=False)
        except Exception as error:  # noqa: BLE001
            log.warning("couldn't resume %s: %s", path.name, error)
            path.unlink(missing_ok=True)


# ---- HTTP ------------------------------------------------------------------------------------


def valid_chapter(chapter) -> bool:
    if not isinstance(chapter, dict):
        return False
    lines = chapter.get("lines")
    return (
        isinstance(chapter.get("section"), int)
        and isinstance(lines, list)
        and 0 < len(lines) <= 20_000
        and all(isinstance(l.get("say"), str) and isinstance(l.get("text"), str) and isinstance(l.get("start"), int) and isinstance(l.get("end"), int) for l in lines)
    )


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send(self, status: int, body: bytes = b"", content_type="application/json", headers: dict | None = None):
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def json(self, status: int, value):
        self.send(status, json.dumps(value).encode())

    def body(self) -> dict:
        length = int(self.headers.get("content-length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def query(self) -> dict:
        return {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).items()}

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/health":
            # The reader asks when it opens: with a Kokoro voice (?warm=1), get the listening voice ready, in case it's wanted.
            if self.query().get("warm") == "1":
                threading.Thread(target=live_voice, daemon=True).start()
            with changed:
                running = {wid: {"ready": v.ready, "job": v.job.key if v.job else None} for wid, v in voices.items()}
            return self.json(200, {"ok": True, "voices": running, "fish": bool(FISH_KEY)})
        if path == "/jobs":
            book = self.query().get("book", "")
            with changed:
                found = [j.report() for j in jobs.values() if j.book == book]
            return self.json(200, {"jobs": sorted(found, key=lambda j: j["section"])})
        self.json(404, {"error": "Not found."})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            body = self.body()
        except ValueError:
            return self.json(400, {"error": "Invalid JSON."})
        voice = body.get("voice")
        fish = voice in FISH and bool(FISH_KEY)
        if voice not in VOICES and not fish:
            return self.json(400, {"error": "Unknown voice." if voice not in FISH else "Fish Audio isn't set up here (fish-key)."})
        if path == "/speak":
            # Fish's voices are spoken through the site; only saving them happens here.
            if fish:
                return self.json(400, {"error": "Fish voices are spoken by the site."})
            text = body.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 5000:
                return self.json(400, {"error": "Invalid text."})
            pcm = speak_live(text, body["voice"])
            if pcm is None:
                return self.json(503, {"error": "The voice isn't available."})
            return self.send(200, pcm, "application/octet-stream", {"x-sample-rate": str(SAMPLE_RATE)})
        if path == "/jobs":
            book, chapters = body.get("book"), body.get("chapters")
            if not isinstance(book, str) or not BOOK_ID.match(book) or not isinstance(chapters, list) or not all(map(valid_chapter, chapters)):
                return self.json(400, {"error": "Invalid chapters."})
            return self.json(202, {"queued": enqueue(book, body["voice"], chapters, bool(body.get("urgent")))})
        self.json(404, {"error": "Not found."})

    def do_DELETE(self):
        if urllib.parse.urlparse(self.path).path != "/jobs":
            return self.json(404, {"error": "Not found."})
        q = self.query()
        with changed:
            for job in jobs.values():
                if job.book != q.get("book") or job.voice != q.get("voice") or job.state not in ("queued", "making"):
                    continue
                job.cancelled = True
                if job.state == "queued":
                    finish(job, "cancelled")
                job.stop.set()
            for v in voices.values():
                if v.job and v.job.cancelled:
                    v.cancel.set()
        self.send(204)

    def log_message(self, format, *args):  # noqa: A002 - quiet; jobs log what matters
        pass


def main():
    global events
    events = ctx.Queue()
    resume()
    threading.Thread(target=listen, daemon=True).start()
    threading.Thread(target=schedule, daemon=True).start()
    threading.Thread(target=fish_saver, daemon=True).start()
    log.info("listening on 127.0.0.1:%d, saving to %s, up to %d saving at once%s", PORT, SITE, WORKERS, ", and Fish voices" if FISH_KEY else "")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
