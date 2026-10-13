import "server-only";
import { FISH_VOICES, SPEECH_SAMPLE_RATE } from "./voices";

/**
 * Fish Audio's text to speech (https://docs.fish.audio), for the narrator's Fish voices. The
 * free model (`s2.1-pro-free`) is the paid one under a fair-use policy, with up to five requests
 * at once per account; the reader keeps to fewer, and waits and tries again when told it's busy.
 */

const API = "https://api.fish.audio/v1/tts";
const MODEL = "s2.1-pro-free";

export const fishEnabled = () => Boolean(process.env.FISH_API_KEY);

/**
 * Text as Fish should read it. The reader sends it ready: the book's own square brackets made
 * parentheses, and directions in brackets (lib/directions.ts). Only `<|…|>`, which S2 takes as
 * speaker turns, is defused here.
 */
export function fishText(text: string): string {
  return text.replace(/<\|/g, "<").replace(/\|>/g, ">");
}

/** One sentence in a Fish voice, as Fish answers: 16-bit mono PCM at 24 kHz when it's 200. */
export function fishSpeak(text: string, voice: string, signal?: AbortSignal): Promise<Response> {
  return fetch(API, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.FISH_API_KEY}`, "content-type": "application/json", model: MODEL },
    body: JSON.stringify({
      text: fishText(text),
      reference_id: FISH_VOICES[voice],
      format: "pcm",
      sample_rate: SPEECH_SAMPLE_RATE,
      latency: "normal",
    }),
    signal,
  });
}
