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

Jobs waiting are kept in jobs/ and picked up again after a restart. Setup is in the README
(Listening on a GPU server); narrator.service and narrator-tunnel.service keep it running.
"""

import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import lameenc
import numpy as np
import torch
from kokoro import KModel, KPipeline

HOME = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8880"))
SITE = os.environ.get("SITE_URL", "https://read.sharathchenna.com").rstrip("/")
TOKEN = (HOME / "site-token").read_text().strip()
JOBS = HOME / "jobs"
REPO = "hexgrad/Kokoro-82M"

# The same as narrator.ts and narrator.worker.ts, so a chapter saved here plays like one saved there.
SAMPLE_RATE = 24_000
MP3_KBPS = 64
CHUNK_GAP = round(SAMPLE_RATE * 0.06)
VOICES = {"af_heart", "af_bella", "bf_emma", "am_michael", "bm_george"}
BOOK_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("narrator")

# One model on the GPU, with a pronunciation pipeline per accent: American (a) and British (b).
model = KModel(repo_id=REPO).to("cuda").eval()
pipelines = {lang: KPipeline(lang_code=lang, repo_id=REPO, model=model) for lang in "ab"}
# The GPU speaks one sentence at a time; a sentence to listen to waits for at most one being saved.
gpu = threading.Lock()


def speak(text: str, voice: str) -> np.ndarray:
    """A sentence's audio at 24 kHz. Kokoro splits a long one into pieces, joined with a short gap."""
    with gpu, torch.inference_mode():
        parts = [r.audio.cpu().numpy() for r in pipelines[voice[0]](text, voice=voice, split_pattern=None) if r.audio is not None]
    if not parts:
        return np.zeros(0, dtype=np.float32)
    gap = np.zeros(CHUNK_GAP, dtype=np.float32)
    joined = [parts[0]]
    for part in parts[1:]:
        joined += [gap, part]
    return np.concatenate(joined).astype(np.float32)


def pcm16(audio: np.ndarray) -> bytes:
    return (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()


# ---- saving chapters ------------------------------------------------------------------------


class Job:
    def __init__(self, book: str, voice: str, section: int, lines: list, urgent: bool):
        self.book, self.voice, self.section, self.lines, self.urgent = book, voice, section, lines, urgent
        self.state = "queued"
        self.made = 0
        self.started = 0.0
        self.error = ""
        self.cancelled = False

    @property
    def key(self) -> str:
        return f"{self.book}.{self.voice}.{self.section}"

    def report(self) -> dict:
        out = {"section": self.section, "voice": self.voice, "state": self.state, "made": self.made, "total": len(self.lines)}
        elapsed = time.time() - self.started
        if self.state == "making" and self.made >= 10 and elapsed > 2:
            out["left"] = round(elapsed / self.made * (len(self.lines) - self.made), 1)
        if self.error:
            out["error"] = self.error
        return out


jobs: dict[str, Job] = {}
changed = threading.Condition()


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
        changed.notify()
    return added


def next_job() -> Job:
    """Chapters someone is waiting to listen to first, then the rest in the order asked for."""
    with changed:
        while True:
            queued = [j for j in jobs.values() if j.state == "queued"]
            if queued:
                job = next((j for j in reversed(queued) if j.urgent), queued[0])
                job.state = "making"
                job.started = time.time()
                return job
            changed.wait()


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


def make(job: Job):
    """Speaks a chapter, encodes it as the browser does, and saves it with its sentences' timings."""
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(MP3_KBPS)
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    mp3 = bytearray()
    timings = []
    t = 0.0
    for i, line in enumerate(job.lines):
        if job.cancelled:
            return
        audio = speak(line["say"], job.voice)
        timings.append({"start": line["start"], "end": line["end"], "text": line["text"], "t0": round(t, 3), "t1": round(t + len(audio) / SAMPLE_RATE, 3)})
        pause = np.zeros(round(SAMPLE_RATE * float(line.get("pause", 0))), dtype=np.float32)
        t += (len(audio) + len(pause)) / SAMPLE_RATE
        mp3 += encoder.encode(pcm16(np.concatenate([audio, pause])))
        job.made = i + 1
    mp3 += encoder.flush()

    job.state = "saving"
    base = f"/api/books/{job.book}/audio/{job.section}"
    start = site("POST", base, {"voice": job.voice, "bytes": len(mp3)})
    # A presigned storage URL, or (without R2) one on the site carrying its own token.
    upload = urllib.parse.urljoin(SITE + "/", start["uploadUrl"])
    site("PUT", upload, raw=bytes(mp3), content_type="audio/mpeg", absolute=True)
    site("PUT", base, {"voice": job.voice, "bytes": len(mp3), "duration": round(t, 3), "lines": timings})


def work():
    while True:
        job = next_job()
        try:
            make(job)
            job.state = "cancelled" if job.cancelled else "done"
            log.info("%s %s: %d sentences in %.0fs", job.state, job.key, len(job.lines), time.time() - job.started)
        except Exception as error:  # noqa: BLE001 - one chapter failing mustn't stop the rest
            job.state, job.error = "failed", str(error)
            log.warning("failed %s: %s", job.key, error)
        drop_file(job)
        with changed:
            # Finished chapters are reported for a while, so the reader sees them through.
            for key, old in list(jobs.items()):
                if old.state in ("done", "failed", "cancelled") and time.time() - old.started > 3600:
                    del jobs[key]


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
            return self.json(200, {"ok": True, "device": torch.cuda.get_device_name(0)})
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
        if body.get("voice") not in VOICES:
            return self.json(400, {"error": "Unknown voice."})
        if path == "/speak":
            text = body.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 5000:
                return self.json(400, {"error": "Invalid text."})
            audio = speak(text, body["voice"])
            return self.send(200, pcm16(audio), "application/octet-stream", {"x-sample-rate": str(SAMPLE_RATE)})
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
                if job.book == q.get("book") and job.voice == q.get("voice") and job.state in ("queued", "making"):
                    job.cancelled = True
                    if job.state == "queued":
                        job.state = "cancelled"
                        drop_file(job)
        self.send(204)

    def log_message(self, format, *args):  # noqa: A002 - quiet; jobs log what matters
        pass


if __name__ == "__main__":
    speak("Ready.", "af_heart")
    resume()
    threading.Thread(target=work, daemon=True).start()
    log.info("listening on 127.0.0.1:%d, saving to %s", PORT, SITE)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
