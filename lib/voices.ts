/**
 * The narrator's voices. Kokoro's run on the GPU server or in the browser (narrator.worker.ts);
 * Fish Audio's are spoken by its S2.1 Pro model, through the site (lib/fish.ts) or the GPU
 * server's job runner, which needs no GPU for them. Ids look alike (`xx_name`), so saved audio
 * is stored the same way whichever made it.
 */

export type VoiceInfo = { id: string; name: string; accent: string; maker: "Fish Audio" | "Kokoro" };

/** Fish's official voices, by the reference id its API takes. */
export const FISH_VOICES: Record<string, string> = {
  fi_ethan: "536d3a5e000945adb7038665781a4aca",
  fi_adrian: "bf322df2096a46f18c579d0baa36f41d",
};

export const VOICES: VoiceInfo[] = [
  { id: "fi_ethan", name: "Ethan", accent: "American", maker: "Fish Audio" },
  { id: "fi_adrian", name: "Adrian", accent: "American", maker: "Fish Audio" },
  { id: "af_heart", name: "Heart", accent: "American", maker: "Kokoro" },
  { id: "af_bella", name: "Bella", accent: "American", maker: "Kokoro" },
  { id: "bf_emma", name: "Emma", accent: "British", maker: "Kokoro" },
  { id: "am_michael", name: "Michael", accent: "American", maker: "Kokoro" },
  { id: "bm_george", name: "George", accent: "British", maker: "Kokoro" },
];

/** The voice a book is read in when nothing else decides. */
export const DEFAULT_VOICE = "fi_ethan";

export const isFishVoice = (voice: string) => Object.hasOwn(FISH_VOICES, voice);

/** Fish's sample rate when asked for 24 kHz PCM, the rate everything else here uses. */
export const SPEECH_SAMPLE_RATE = 24_000;
