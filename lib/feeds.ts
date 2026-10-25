import "server-only";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { batched, db } from "./db";
import { saveLink } from "./save";
import { getStorage } from "./storage";
import { getTriage, setTriage, type Place } from "./triage";

/**
 * The owner's feeds, as Readwise Reader's Feed keeps them: sites subscribed to by their RSS or
 * Atom feed (found from the site's own page when given that), checked every hour (worker.ts), and
 * what each has published, seen or not. An item opened or saved becomes a clipping, read,
 * highlighted and searched like anything else; one only opened stays in the Feed (its place
 * "feed"), one saved goes to the library's Inbox or Later.
 */

export type Feed = {
  id: string;
  /** The feed itself. */
  url: string;
  title: string;
  /** The site it's for. */
  site?: string;
  icon?: string;
  description?: string;
  /** Why the last check failed, if it did. */
  error?: string;
  etag?: string;
  lastModified?: string;
};

export type FeedItem = {
  id: string;
  feedId: string;
  url: string;
  title: string;
  author?: string;
  /** A sentence or two of it, as plain text. */
  summary?: string;
  image?: string;
  /** ISO time. */
  published: string;
  /** The post as its feed carries it (HTML), when it does: read in place of a page with too little on it. Not listed. */
  content?: string;
  /** A podcast episode's audio. */
  audio?: { url: string; type?: string; seconds?: number; transcript?: { url: string; type?: string } };
  seen: boolean;
  clipId?: string;
};

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; book-shelf-feeds/0.1; personal reading shelf)",
  Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5",
};
/** Items taken from a feed when it's first subscribed to, newest first. */
const FIRST_ITEMS = 12;
/** Seen items kept per feed (unseen and saved ones are always kept). */
const KEEP_PER_FEED = 150;
/** How much of a post's own text (HTML) is kept from its feed. */
const MAX_CONTENT = 120_000;
/** Where a clipping made from a feed item keeps the post as its feed had it (for /api/books/clips/source). */
export const feedContentKey = (clipId: string) => `feed/${clipId}.html`;
/** Items read from a feed at a time, the newest. */
const MAX_ITEMS = 60;
/** Feeds checked per run, the longest unchecked first; the hourly runs take turns through the rest. */
const FEEDS_PER_RUN = 10;

const hash = (s: string, n: number) => createHash("sha1").update(s).digest("hex").slice(0, n);

// ---- finding and reading a feed ------------------------------------------------------------------

const looksLikeFeed = (type: string, body: string) => /xml|rss|atom/.test(type) || /^\s*(<\?xml|<rss|<feed|<rdf:RDF)/i.test(body.slice(0, 500));

/** A feed from a link to it, or to the site it's for (the page's own feed link, else the usual places). */
export async function discover(input: string): Promise<{ url: string; xml: string }> {
  const url = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`The site answered ${res.status}.`);
  const body = await res.text();
  const at = res.url || url;
  if (looksLikeFeed(res.headers.get("content-type") ?? "", body)) return { url: at, xml: body };

  const linked = [...body.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .filter((tag) => /rel=["']?alternate/i.test(tag) && /type=["']?application\/(rss|atom)\+xml/i.test(tag))
    .map((tag) => tag.match(/href=["']([^"']+)["']/i)?.[1])
    .filter((href): href is string => Boolean(href))
    .map((href) => new URL(href.replace(/&amp;/g, "&"), at).toString());
  const origin = new URL(at).origin;
  const guesses = ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml", "/feed/"].map((p) => origin + p);
  for (const candidate of [...linked, ...guesses]) {
    const r = await fetch(candidate, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!r?.ok) continue;
    const xml = await r.text();
    if (looksLikeFeed(r.headers.get("content-type") ?? "", xml)) return { url: r.url || candidate, xml };
  }
  throw new Error("Couldn't find a feed there. Try the link to the feed itself.");
}

/**
 * A feed cut to its first `n` items (feeds list the newest first), closed again: a podcast's can
 * hold thousands of episodes, too many to read through on every check.
 */
function trim(xml: string, n: number): string {
  const close = /<\/(item|entry)>/gi;
  let match: RegExpExecArray | null = null;
  for (let i = 0; i < n; i++) {
    match = close.exec(xml);
    if (!match) return xml;
  }
  if (!close.exec(xml)) return xml;
  const end = match!.index + match![0].length;
  const tail = /<rss\b/i.test(xml) ? "</channel></rss>" : /<rdf:RDF\b/i.test(xml) ? "</rdf:RDF>" : "</feed>";
  return xml.slice(0, end) + tail;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", parseTagValue: false, trimValues: true });

type Node = Record<string, unknown>;
const list = (v: unknown): Node[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]) as Node[];
/** A node's text: itself if a string, else its text. */
const text = (v: unknown): string | undefined => {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (v && typeof v === "object") return text((v as Node)["#text"]);
  return undefined;
};
const attr = (v: unknown, name: string): string | undefined => {
  const node = list(v)[0];
  const value = node?.[`@${name}`];
  return typeof value === "string" ? value : undefined;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m),
  );
/** HTML as a sentence or two of plain text. */
const plain = (html: string | undefined, max = 320): string | undefined => {
  if (!html) return undefined;
  const t = decode(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return t ? (t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : t) : undefined;
};
const firstImage = (html: string | undefined, base: string) => {
  const src = html?.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  try {
    return src ? new URL(decode(src), base).toString() : undefined;
  } catch {
    return undefined;
  }
};
const iso = (s: string | undefined) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};
/** "1:02:03", "62:03" or seconds, as seconds. */
const seconds = (s: string | undefined) => {
  if (!s) return undefined;
  const parts = s.split(":").map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  return parts.reduce((n, p) => n * 60 + p, 0) || undefined;
};

type Parsed = { title: string; site?: string; description?: string; icon?: string; items: Omit<FeedItem, "feedId" | "seen" | "id">[] & { key: string }[] };

/** An RSS or Atom feed's title, site and items (newest first). */
export function parse(xml: string, feedUrl: string): Parsed {
  const doc = parser.parse(trim(xml, MAX_ITEMS)) as Node;
  const rss = (doc.rss as Node | undefined)?.channel as Node | undefined ?? ((doc["rdf:RDF"] as Node | undefined)?.channel as Node | undefined);
  if (rss) {
    const rdfItems = list((doc["rdf:RDF"] as Node | undefined)?.item);
    const site = text(rss.link) ?? attr(rss["atom:link"], "href");
    const items = [...list(rss.item), ...rdfItems].map((item) => {
      const link = text(item.link) ?? text(item.guid) ?? "";
      const body = text(item["content:encoded"]) ?? text(item.description);
      const enclosure = list(item.enclosure).find((e) => typeof e["@url"] === "string");
      const audio = enclosure && /^audio\//.test(String(enclosure["@type"] ?? "")) ? String(enclosure["@url"]) : undefined;
      const transcript = list(item["podcast:transcript"]).find((t) => typeof t["@url"] === "string");
      const image =
        attr(item["media:thumbnail"], "url") ??
        list(item["media:content"]).find((m) => /^image\//.test(String(m["@type"] ?? "")) || m["@medium"] === "image")?.["@url"] as string | undefined ??
        (enclosure && /^image\//.test(String(enclosure["@type"] ?? "")) ? String(enclosure["@url"]) : undefined) ??
        attr(item["itunes:image"], "href") ??
        firstImage(body, link || feedUrl);
      return {
        key: text(item.guid) ?? link,
        url: link,
        title: plain(text(item.title), 300) ?? plain(body, 90) ?? link,
        author: text(item["dc:creator"]) ?? text(item.author) ?? text(item["itunes:author"]),
        summary: plain(text(item["itunes:summary"]) ?? body),
        content: body && body.length > 200 ? body.slice(0, MAX_CONTENT) : undefined,
        image,
        published: iso(text(item.pubDate) ?? text(item["dc:date"])) ?? new Date().toISOString(),
        ...(audio
          ? {
              audio: {
                url: audio,
                type: String(enclosure!["@type"]),
                seconds: seconds(text(item["itunes:duration"])),
                ...(transcript ? { transcript: { url: String(transcript["@url"]), type: transcript["@type"] as string | undefined } } : {}),
              },
            }
          : {}),
      };
    });
    return {
      title: plain(text(rss.title), 200) ?? new URL(feedUrl).host,
      site,
      description: plain(text(rss.description)),
      icon: text((rss.image as Node | undefined)?.url) ?? attr(rss["itunes:image"], "href"),
      items: items.filter((i) => i.url).sort((a, b) => b.published.localeCompare(a.published)),
    };
  }
  const atom = doc.feed as Node | undefined;
  if (!atom) throw new Error("That isn't an RSS or Atom feed.");
  const href = (links: unknown) => {
    const all = list(links);
    return (all.find((l) => (l["@rel"] ?? "alternate") === "alternate" && l["@href"]) ?? all[0])?.["@href"] as string | undefined;
  };
  const items = list(atom.entry).map((entry) => {
    const link = href(entry.link) ?? text(entry.id) ?? "";
    const group = entry["media:group"] as Node | undefined;
    const body = text(entry.content) ?? text(entry.summary) ?? text(group?.["media:description"]);
    return {
      key: text(entry.id) ?? link,
      url: link,
      title: plain(text(entry.title), 300) ?? link,
      author: text((list(entry.author)[0] as Node | undefined)?.name),
      summary: plain(body),
      content: body && body.length > 200 ? body.slice(0, MAX_CONTENT) : undefined,
      image: attr(group?.["media:thumbnail"], "url") ?? attr(entry["media:thumbnail"], "url") ?? firstImage(body, link || feedUrl),
      published: iso(text(entry.published) ?? text(entry.updated)) ?? new Date().toISOString(),
    };
  });
  return {
    title: plain(text(atom.title), 200) ?? new URL(feedUrl).host,
    site: href(atom.link),
    description: plain(text(atom.subtitle)),
    icon: text(atom.icon) ?? text(atom.logo),
    items: items.filter((i) => i.url).sort((a, b) => b.published.localeCompare(a.published)),
  };
}

// ---- the owner's feeds ---------------------------------------------------------------------------

type FeedRow = { id: string; url: string; data: string; checked_at: string | null };
type ItemRow = { id: string; feed_id: string; seen: number; clip_id: string | null; data: string };

export async function listFeeds(): Promise<(Feed & { checked?: string })[]> {
  const { results } = await (await db()).prepare("SELECT id, url, data, checked_at FROM feeds ORDER BY added_at").all<FeedRow>();
  return results.map((r) => ({ ...(JSON.parse(r.data) as Feed), ...(r.checked_at ? { checked: r.checked_at } : {}) }));
}

/** The newest items across every feed, with whether each has been seen or saved. */
export async function listItems(limit = 400): Promise<FeedItem[]> {
  const { results } = await (await db())
    .prepare("SELECT id, feed_id, seen, clip_id, data FROM feed_items ORDER BY published DESC LIMIT ?1")
    .bind(limit)
    .all<ItemRow>();
  return results.map((r) => {
    // The post's own text stays on the server: the list only needs what a row shows.
    const item = JSON.parse(r.data) as Omit<FeedItem, "seen" | "clipId">;
    delete item.content;
    return { ...item, seen: r.seen === 1, ...(r.clip_id ? { clipId: r.clip_id } : {}) };
  });
}

async function putItems(feedId: string, items: Parsed["items"], { seen = false } = {}): Promise<number> {
  const database = await db();
  const now = new Date().toISOString();
  const rows = items.map((item) => {
    const { key, ...rest } = item as Parsed["items"][number] & { key: string };
    const id = hash(`${feedId} ${key}`, 16);
    const stored: Omit<FeedItem, "seen" | "clipId"> = { ...rest, id, feedId };
    return database
      .prepare("INSERT OR IGNORE INTO feed_items (id, feed_id, published, seen, data, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(id, feedId, stored.published, seen ? 1 : 0, JSON.stringify(stored), now);
  });
  let added = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const results = await database.batch(rows.slice(i, i + 50));
    added += results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return added;
}

/** Subscribes to a site's feed (or the feed given), taking its newest few items. */
export async function subscribe(input: string): Promise<Feed> {
  const { url, xml } = await discover(input);
  const parsed = parse(xml, url);
  const id = hash(url, 12);
  const feed: Feed = { id, url, title: parsed.title, site: parsed.site, icon: parsed.icon, description: parsed.description };
  const now = new Date().toISOString();
  await (await db())
    .prepare("INSERT INTO feeds (id, url, data, added_at, checked_at) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT (url) DO UPDATE SET data = ?3")
    .bind(id, url, JSON.stringify(feed), now)
    .run();
  // Its newest few wait to be seen; the rest are known, so they don't arrive as new on the next check.
  await putItems(id, parsed.items.slice(0, FIRST_ITEMS) as Parsed["items"]);
  await putItems(id, parsed.items.slice(FIRST_ITEMS) as Parsed["items"], { seen: true });
  return feed;
}

/** Unsubscribes: the feed goes, and its items that weren't saved. */
export async function unsubscribe(id: string) {
  const database = await db();
  await database.batch([
    database.prepare("DELETE FROM feeds WHERE id = ?1").bind(id),
    database.prepare("DELETE FROM feed_items WHERE feed_id = ?1 AND clip_id IS NULL").bind(id),
  ]);
}

/** Checks one feed for new items (asking only for what changed), noting any failure on the feed. */
async function refreshFeed(feed: Feed): Promise<number> {
  const database = await db();
  const now = new Date().toISOString();
  const res = await fetch(feed.url, {
    headers: { ...HEADERS, ...(feed.etag ? { "If-None-Match": feed.etag } : {}), ...(feed.lastModified ? { "If-Modified-Since": feed.lastModified } : {}) },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  }).catch((error: Error) => error);
  let added = 0;
  let next: Feed = { ...feed };
  if (res instanceof Error || (!res.ok && res.status !== 304)) {
    next.error = res instanceof Error ? "The feed didn't answer." : `The feed answered ${res.status}.`;
  } else if (res.status !== 304) {
    try {
      const parsed = parse(await res.text(), feed.url);
      added = await putItems(feed.id, parsed.items);
      next = { ...next, title: next.title || parsed.title, site: next.site ?? parsed.site, icon: next.icon ?? parsed.icon };
      delete next.error;
    } catch (error) {
      next.error = (error as Error).message;
    }
    next.etag = res.headers.get("etag") ?? undefined;
    next.lastModified = res.headers.get("last-modified") ?? undefined;
  }
  await database.batch([
    database.prepare("UPDATE feeds SET data = ?2, checked_at = ?3 WHERE id = ?1").bind(feed.id, JSON.stringify(next), now),
    // Old seen items go; unseen and saved ones stay.
    database
      .prepare(
        `DELETE FROM feed_items WHERE feed_id = ?1 AND seen = 1 AND clip_id IS NULL AND id NOT IN
         (SELECT id FROM feed_items WHERE feed_id = ?1 ORDER BY published DESC LIMIT ?2)`,
      )
      .bind(feed.id, KEEP_PER_FEED),
  ]);
  return added;
}

/** Checks the feeds checked longest ago (FEEDS_PER_RUN of them), a few at a time. Returns how many new items came in. */
export async function refreshFeeds(): Promise<{ feeds: number; added: number }> {
  const feeds = (await listFeeds()).sort((a, b) => (a.checked ?? "").localeCompare(b.checked ?? "")).slice(0, FEEDS_PER_RUN);
  let added = 0;
  for (let i = 0; i < feeds.length; i += 4) {
    const counts = await Promise.all(feeds.slice(i, i + 4).map((f) => refreshFeed(f).catch(() => 0)));
    added += counts.reduce((a, b) => a + b, 0);
  }
  return { feeds: feeds.length, added };
}

export async function markItems(ids: string[], seen: boolean) {
  const database = await db();
  await batched(database, ids.map((id) => database.prepare("UPDATE feed_items SET seen = ?2 WHERE id = ?1").bind(id, seen ? 1 : 0)));
}

/** Every unseen item marked seen (the Feed's "all seen"). */
export async function markAllSeen() {
  await (await db()).prepare("UPDATE feed_items SET seen = 1 WHERE seen = 0").run();
}

/**
 * An item opened or saved: made a clipping (once), and placed: left in the Feed when only opened,
 * else moved to the library's Inbox, Later or Archive. Returns the clipping's id.
 */
export async function placeItem(id: string, place: Place): Promise<string> {
  const database = await db();
  const row = await database.prepare("SELECT id, feed_id, seen, clip_id, data FROM feed_items WHERE id = ?1").bind(id).first<ItemRow>();
  if (!row) throw new Error("That item isn't in the Feed any more.");
  const item = JSON.parse(row.data) as FeedItem;
  let clipId = row.clip_id;
  // Whether it was in the library before the Feed brought it (saved there some other way).
  let existed = Boolean(row.clip_id);
  if (!clipId) {
    const saved = await saveLink(item.url, { via: "feed", feedItem: item });
    clipId = saved.clip.id;
    existed = saved.refreshed;
    if (item.content) await getStorage().put(feedContentKey(clipId), item.content, "text/html; charset=utf-8").catch(() => {});
  }
  const current = (await getTriage()).get(clipId) ?? (existed ? { place: "inbox" as Place, seen: true } : { place: "feed" as Place, seen: true });
  // Only opened, it stays where it is: in the Feed, or wherever in the library it already was.
  const target = place === "feed" ? (existed ? current.place : "feed") : place;
  await setTriage([{ id: clipId, current }], { place: target, seen: true });
  await database.prepare("UPDATE feed_items SET clip_id = ?2, seen = 1 WHERE id = ?1").bind(id, clipId).run();
  return clipId;
}
