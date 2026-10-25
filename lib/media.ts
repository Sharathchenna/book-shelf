import "server-only";
import { getJson, putJson } from "./storage";
import type { Clip } from "./types";
import type { XArticle, XArticleBlock } from "./x-article-types";

/**
 * Videos and podcast episodes as things to read, as Readwise Reader keeps them: a YouTube video
 * with its captions, an episode with the transcript its feed publishes, each read as a page with
 * the player at the top and the transcript under it, a line's time a tap from that moment
 * (app/components/reader/x-article-epub.ts sets the page).
 */

/** A moment of a transcript: where it starts, in seconds, and what's said. */
export type Cue = { t: number; text: string };

/** What's kept of a video or episode beside its clipping: its description, and its transcript when there is one. */
export type MediaText = { description?: string; transcript?: Cue[]; language?: string };

const mediaKey = (clipId: string) => `media/${clipId}.json`;

const UA = "Mozilla/5.0 (compatible; book-shelf-clipper/0.1; personal reading shelf)";

// ---- YouTube --------------------------------------------------------------------------------------

/** A YouTube video's id, from any of its links (watch, youtu.be, shorts, live, embed). */
export function youtubeId(url: string): string | undefined {
  const m =
    url.match(/^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)([\w-]{11})/) ??
    url.match(/^https?:\/\/youtu\.be\/([\w-]{11})/) ??
    url.match(/^https?:\/\/(?:www\.)?youtube-nocookie\.com\/embed\/([\w-]{11})/);
  return m?.[1];
}

type Player = {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string; author?: string; lengthSeconds?: string; shortDescription?: string; thumbnail?: { thumbnails?: { url: string; width: number }[] } };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl: string; languageCode: string; kind?: string; name?: { runs?: { text: string }[] } }[] } };
};

/** YouTube's player answer for a video, as its Android app asks: details and caption tracks. */
async function player(id: string): Promise<Player> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json", "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip" },
    body: JSON.stringify({ videoId: id, context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, hl: "en" } } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`YouTube answered ${res.status}`);
  return (await res.json()) as Player;
}

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** A caption track (YouTube's timed text, format 3) as cues; "[Music]" and the like left out. */
async function captions(baseUrl: string): Promise<Cue[]> {
  const res = await fetch(baseUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return [];
  const xml = await res.text();
  const cues: Cue[] = [];
  for (const [, t, body] of xml.matchAll(/<p\b[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = decode(body.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (text && !/^\[[^\]]+\]$/.test(text)) cues.push({ t: Number(t) / 1000, text });
  }
  return cues;
}

/** The track to read: one written by people in English, else YouTube's own English, else the first. */
function bestTrack(tracks: NonNullable<NonNullable<Player["captions"]>["playerCaptionsTracklistRenderer"]>["captionTracks"]) {
  if (!tracks?.length) return undefined;
  const en = (t: { languageCode: string }) => t.languageCode === "en" || t.languageCode.startsWith("en-");
  return tracks.find((t) => en(t) && t.kind !== "asr") ?? tracks.find((t) => en(t)) ?? tracks.find((t) => t.kind !== "asr") ?? tracks[0];
}

/**
 * A video as YouTube's public oEmbed describes it (its title, channel and picture): for when its
 * player turns the server away ("confirm you're not a bot"). The app then fetches the captions
 * itself, from the owner's own connection, and sends them (/api/media/[id]).
 */
async function oembed(id: string): Promise<{ clip: Omit<Clip, "id" | "saved" | "tags">; text: MediaText }> {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(res.status === 404 ? "That video isn't on YouTube, or it's private" : `YouTube answered ${res.status}`);
  const o = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
  if (!o.title) throw new Error("YouTube didn't describe that video");
  return {
    clip: { kind: "video", url, title: o.title, author: o.author_name, source: "YouTube", image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, media: { kind: "youtube", id, channel: o.author_name, transcript: false } },
    text: {},
  };
}

/** A YouTube video as a clipping's details, its description and captions kept beside it. */
export async function fetchYouTube(id: string): Promise<{ clip: Omit<Clip, "id" | "saved" | "tags">; text: MediaText }> {
  const p = await player(id).catch(() => null);
  const d = p?.videoDetails;
  if (!p || !d?.title) return oembed(id);
  const track = bestTrack(p.captions?.playerCaptionsTracklistRenderer?.captionTracks);
  // (The details came through; the captions may still be refused, in which case the app sends them.)
  const transcript = track ? await captions(track.baseUrl).catch(() => []) : [];
  const seconds = Number(d.lengthSeconds) || undefined;
  const description = d.shortDescription?.trim();
  return {
    clip: {
      kind: "video",
      url: `https://www.youtube.com/watch?v=${id}`,
      title: d.title,
      author: d.author,
      source: "YouTube",
      excerpt: description ? description.split(/\n\s*\n/)[0].slice(0, 320) : undefined,
      image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      minutes: seconds ? Math.max(1, Math.round(seconds / 60)) : undefined,
      media: { kind: "youtube", id, seconds, channel: d.author, transcript: transcript.length > 0 },
    },
    text: { description, transcript: transcript.length ? transcript : undefined, language: track?.languageCode },
  };
}

// ---- podcasts -------------------------------------------------------------------------------------

/** An Apple Podcasts episode's id (`?i=`), from its link. */
export const appleEpisodeId = (url: string) => (/^https?:\/\/podcasts\.apple\.com\//.test(url) ? url.match(/[?&]i=(\d+)/)?.[1] : undefined);
/** The show's id in an Apple Podcasts link (`/id123…`). */
const appleShowId = (url: string) => url.match(/\/id(\d+)/)?.[1];

/** Whether a link is to an audio file itself. */
export const isAudioFile = (url: string) => /\.(mp3|m4a|aac|ogg|opus|wav)(\?|#|$)/i.test(url);

/** A transcript file a podcast publishes (WebVTT, SRT, or Podcasting 2.0's JSON) as cues. */
export async function fetchTranscript(url: string, type?: string): Promise<Cue[]> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return [];
  const body = await res.text();
  if (/json/.test(type ?? res.headers.get("content-type") ?? "") || body.trimStart().startsWith("{")) {
    const data = JSON.parse(body) as { segments?: { startTime?: number; body?: string }[] };
    return (data.segments ?? []).filter((s) => s.body?.trim()).map((s) => ({ t: s.startTime ?? 0, text: s.body!.trim() }));
  }
  // WebVTT and SRT: a time line ("00:01:02.345 --> …"), then the words.
  const cues: Cue[] = [];
  for (const block of body.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => /-->/.test(l));
    if (at < 0) continue;
    const [h, m, s] = (lines[at].split("-->")[0].trim().replace(",", ".").match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/)?.slice(1) ?? []).map((v) => Number(v ?? 0));
    const text = lines.slice(at + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text) cues.push({ t: (h || 0) * 3600 + (m || 0) * 60 + (s || 0), text });
  }
  return cues;
}

/** An episode found in its show's feed, by its audio file or its title: the transcript it publishes, if any. */
async function transcriptFromFeed(feedUrl: string, audio: string, title?: string): Promise<Cue[]> {
  const res = await fetch(feedUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return [];
  const xml = await res.text();
  const file = audio.split("?")[0].split("/").pop() ?? "";
  for (const [item] of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    if (!(file && item.includes(file)) && !(title && item.includes(title))) continue;
    const tag = item.match(/<podcast:transcript\b[^>]*>/i)?.[0];
    const url = tag?.match(/url=["']([^"']+)["']/)?.[1];
    return url ? fetchTranscript(decode(url), tag?.match(/type=["']([^"']+)["']/)?.[1]) : [];
  }
  return [];
}

/** An Apple Podcasts episode as a clipping's details (from Apple's lookup), with its feed's transcript if it has one. */
export async function fetchAppleEpisode(link: string): Promise<{ clip: Omit<Clip, "id" | "saved" | "tags">; text: MediaText }> {
  const id = appleEpisodeId(link)!;
  // Apple looks episodes up by their show, not on their own: the show's latest 200, the one wanted among them.
  const show = appleShowId(link);
  if (!show) throw new Error("That Apple Podcasts link doesn't name its show");
  const res = await fetch(`https://itunes.apple.com/lookup?id=${show}&entity=podcastEpisode&limit=200`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Apple answered ${res.status}`);
  const found = ((await res.json()) as { results?: Record<string, unknown>[] }).results ?? [];
  const ep = found.find((r) => r.wrapperType === "podcastEpisode" && String(r.trackId) === id);
  if (!ep?.episodeUrl) throw new Error("Apple didn't describe that episode (it may be older than the show's latest 200)");
  const audio = String(ep.episodeUrl);
  const seconds = Number(ep.trackTimeMillis) / 1000 || undefined;
  const transcript = typeof ep.feedUrl === "string" ? await transcriptFromFeed(ep.feedUrl, audio, String(ep.trackName ?? "")).catch(() => []) : [];
  const description = typeof ep.description === "string" ? ep.description.trim() : undefined;
  return {
    clip: {
      kind: "podcast",
      url: String(ep.trackViewUrl ?? `https://podcasts.apple.com/podcast/id${ep.collectionId}?i=${id}`),
      title: String(ep.trackName),
      author: String(ep.collectionName ?? ep.artistName ?? ""),
      source: String(ep.collectionName ?? "Podcast"),
      excerpt: description?.slice(0, 320),
      image: String(ep.artworkUrl600 ?? ep.artworkUrl160 ?? "") || undefined,
      published: typeof ep.releaseDate === "string" ? ep.releaseDate.slice(0, 10) : undefined,
      minutes: seconds ? Math.max(1, Math.round(seconds / 60)) : undefined,
      media: { kind: "audio", audio, seconds, channel: String(ep.collectionName ?? ""), transcript: transcript.length > 0 },
    },
    text: { description, transcript: transcript.length ? transcript : undefined },
  };
}

/**
 * An episode from a feed (lib/feeds.ts), or a bare audio file: its audio, its feed's description,
 * and the transcript it publishes when it does.
 */
export async function audioEpisode(
  url: string,
  audio: { url: string; seconds?: number; transcript?: { url: string; type?: string } },
  about: { title?: string; author?: string; summary?: string; image?: string; published?: string; source?: string },
): Promise<{ clip: Omit<Clip, "id" | "saved" | "tags">; text: MediaText }> {
  const transcript = audio.transcript ? await fetchTranscript(audio.transcript.url, audio.transcript.type).catch(() => []) : [];
  return {
    clip: {
      kind: "podcast",
      url,
      title: about.title ?? decodeURIComponent(audio.url.split("?")[0].split("/").pop() ?? "An episode"),
      author: about.author,
      source: about.source ?? new URL(url).host.replace(/^www\./, ""),
      excerpt: about.summary,
      image: about.image,
      published: about.published?.slice(0, 10),
      minutes: audio.seconds ? Math.max(1, Math.round(audio.seconds / 60)) : undefined,
      media: { kind: "audio", audio: audio.url, seconds: audio.seconds, transcript: transcript.length > 0 },
    },
    text: { description: about.summary, transcript: transcript.length ? transcript : undefined },
  };
}

// ---- kept beside the clipping, and read as a page -------------------------------------------------

export async function putMediaText(clipId: string, text: MediaText) {
  await putJson(mediaKey(clipId), text);
}

/** "1:02:03" or "2:03". */
const stamp = (t: number) => {
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

/** Cues run into paragraphs: a new one about every half minute, at the end of a sentence where there is one. */
function paragraphs(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const cue of cues) {
    const last = out[out.length - 1];
    const long = last && (cue.t - last.t > 45 || (cue.t - last.t > 25 && /[.!?…]["”’)]?$/.test(last.text)));
    if (!last || long) out.push({ ...cue });
    else last.text = `${last.text} ${cue.text}`.replace(/\s+/g, " ");
  }
  return out;
}

const run = (text: string, extra: Partial<XArticleBlock> = {}): XArticleBlock => ({ type: "unstyled", text, depth: 0, styles: [], links: [], ...extra });

/**
 * A video or episode as an article to make an ebook of: the player at the top, its description,
 * then the transcript, each paragraph with the moment it starts (`cue`). The transcript is fetched
 * now if it wasn't when it was saved (YouTube's captions can be slow to appear).
 */
export async function mediaArticle(clip: Clip): Promise<XArticle> {
  let text = (await getJson<MediaText>(mediaKey(clip.id))) ?? {};
  const media = clip.media;
  if (!text.transcript && media?.kind === "youtube" && media.id) {
    const fresh = await fetchYouTube(media.id).catch(() => null);
    if (fresh?.text.transcript) {
      text = { ...text, ...fresh.text };
      await putMediaText(clip.id, text).catch(() => {});
    }
  }
  const blocks: XArticleBlock[] = [];
  if (media?.kind === "youtube" && media.id) {
    blocks.push(
      run("", {
        type: "atomic",
        embed: { kind: "youtube", player: `https://www.youtube-nocookie.com/embed/${media.id}?enablejsapi=1&playsinline=1&rel=0`, url: clip.url, title: clip.title },
      }),
    );
  } else if (media?.audio) {
    blocks.push(run("", { type: "atomic", audio: { src: media.audio } }));
  }
  // The description's opening, not its lists of links (to Patreon, the music, the socials…).
  const said = (text.description ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter((p) => p && p.replace(/https?:\/\/\S+/g, "").replace(/[^\p{L}]/gu, "").length > p.length * 0.6 && !/^[-–—_=*·•\s]+$/.test(p));
  for (const para of said.slice(0, 4)) blocks.push(run(para));
  if (text.transcript?.length) {
    blocks.push(run("Transcript", { type: "header-two" }));
    for (const p of paragraphs(text.transcript)) blocks.push(run(p.text, { cue: p.t, cueLabel: stamp(p.t) }));
  } else {
    blocks.push(run(media?.kind === "youtube" ? "This video has no captions to read, so there's no transcript." : "This episode's feed publishes no transcript."));
  }
  return {
    id: clip.id,
    url: clip.url,
    title: clip.title ?? "Untitled",
    preview: "",
    cover: media?.kind === "youtube" ? undefined : clip.image,
    published: clip.published,
    author: { name: clip.author ?? clip.source },
    site: clip.source,
    blocks,
  };
}

/** Cues as they arrive from the app, cleaned: at most 20,000, each with its time and up to 2,000 characters. */
export function cleanCues(list: unknown): Cue[] | null {
  if (!Array.isArray(list) || list.length > 20_000) return null;
  const cues: Cue[] = [];
  for (const c of list as Partial<Cue>[]) {
    if (typeof c?.t !== "number" || !Number.isFinite(c.t) || typeof c.text !== "string") return null;
    const text = c.text.replace(/\s+/g, " ").trim().slice(0, 2000);
    if (text) cues.push({ t: Math.max(0, Math.round(c.t * 100) / 100), text });
  }
  return cues;
}
