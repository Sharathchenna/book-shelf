/**
 * The bookcase on the home page: every book and clipping, shelved by topic. A fixed set of
 * topics, each with a cloth colour (four shades, so its books look like a set), a painted plate
 * and a small clay icon (public/library/). Books get their spine, height and colour from their
 * id, so the same book always looks the same; a book from Goodreads wears its own cover's colour.
 *
 * Shared by the page (the shelves) and the server (the classifier, lib/ai/shelver.ts): no React,
 * no fetches. The topics, plates and icons come from Gloss.
 */
import type { ClipKind } from "./types";

export type TopicKey =
  | "ai"
  | "programming"
  | "infra"
  | "data"
  | "security"
  | "tech"
  | "design"
  | "product"
  | "startups"
  | "business"
  | "work"
  | "economics"
  | "money"
  | "science"
  | "health"
  | "mind"
  | "climate"
  | "philosophy"
  | "history"
  | "politics"
  | "culture"
  | "writing"
  | "learning"
  | "living"
  | "unsorted";

export type Topic = {
  key: TopicKey;
  name: string;
  /** Cloth shades: [base, light, deep, pale]. */
  shades: [string, string, string, string];
  blurb: string;
  /** What belongs here, for the classifier. */
  hint: string;
};

export const TOPICS: Topic[] = [
  { key: "ai", name: "AI", shades: ["#5b4a9e", "#7a68bf", "#3b2f6e", "#a597d6"], hint: "machine learning, language models, AI research, AI products and agents", blurb: "Machines that learn: models, agents, research and what it all means." },
  { key: "programming", name: "Programming", shades: ["#2f4f8f", "#4a6fb3", "#1d3263", "#8aa6d8"], hint: "software engineering, languages, code, developer tools, open source, engineering practice", blurb: "How software is made, and the people who make it." },
  { key: "infra", name: "Infrastructure", shades: ["#6b6a2a", "#8b8a43", "#4a491a", "#bdbb7f"], hint: "systems, cloud, GPUs, chips, inference, databases, distributed systems, performance, devops", blurb: "The machinery underneath: systems, chips, clouds and the bills that come with them." },
  { key: "data", name: "Data", shades: ["#2a6f8a", "#4a90a8", "#1a4c60", "#8fc0d0"], hint: "data science, analytics, statistics, visualisation, data engineering", blurb: "Counting things carefully, and showing what the numbers say." },
  { key: "security", name: "Security", shades: ["#3d4a52", "#5b6a73", "#262f35", "#9aa8b0"], hint: "security, privacy, cryptography, attacks, trust", blurb: "Locks, keys, and the people trying both." },
  { key: "tech", name: "Tech & internet", shades: ["#3e6c9e", "#5e8cbe", "#284b70", "#a3c2e2"], hint: "the tech industry and its founders, platforms, internet culture, gadgets, big tech news", blurb: "The industry, the platforms and the internet we live on." },
  { key: "design", name: "Design", shades: ["#c0603a", "#d9805a", "#8f4224", "#efb698"], hint: "design, UX, typography, interfaces, craft, architecture", blurb: "How things look, feel and work." },
  { key: "product", name: "Product", shades: ["#8a5a9e", "#a87abb", "#62406f", "#cfb0dc"], hint: "product management, building products, user research, launches, growth", blurb: "Deciding what to build, and finding out if it worked." },
  { key: "startups", name: "Startups", shades: ["#a43848", "#c65767", "#782333", "#e39aa5"], hint: "startups, founders, fundraising, venture capital, go to market", blurb: "Building things people want, from the first users onward." },
  { key: "business", name: "Business", shades: ["#7a5230", "#9a7050", "#563820", "#c9a585"], hint: "companies, strategy, management, markets, competition", blurb: "Companies, strategy and how markets move." },
  { key: "work", name: "Work & careers", shades: ["#7a4b32", "#9a6a4e", "#563220", "#c9a088"], hint: "careers, hiring, leadership, teams, productivity at work, remote work", blurb: "Jobs, teams, and doing good work for a long time." },
  { key: "economics", name: "Economics", shades: ["#40705a", "#5f9078", "#2a4e3e", "#a0c8b4"], hint: "economics, policy, trade, labour markets, macro", blurb: "Incentives, trade-offs and how the whole system behaves." },
  { key: "money", name: "Money", shades: ["#8a7a20", "#a89838", "#5f5410", "#d6ca82"], hint: "personal finance, investing, markets, wealth, crypto", blurb: "Saving, investing and the stories we tell about money." },
  { key: "science", name: "Science", shades: ["#3a6b45", "#5a8d5e", "#274a30", "#9cc29a"], hint: "physics, biology, chemistry, maths, space, research and how science works", blurb: "How the world works, and how we find out." },
  { key: "health", name: "Health", shades: ["#b5485e", "#cf6a7e", "#86303f", "#eda9b6"], hint: "health, medicine, fitness, nutrition, sleep", blurb: "Bodies, medicine and staying well." },
  { key: "mind", name: "Mind", shades: ["#4c5fa8", "#6c7ec4", "#33427a", "#aab6e6"], hint: "psychology, neuroscience, behaviour, habits, emotions, decision making, self-help", blurb: "Why we think, feel and decide the way we do." },
  { key: "climate", name: "Climate & energy", shades: ["#4f7f3a", "#6f9f55", "#355a25", "#aed096"], hint: "climate change, energy, environment, sustainability", blurb: "Energy, the planet and what we do next." },
  { key: "philosophy", name: "Philosophy", shades: ["#5e4b7a", "#7c6a99", "#3f3154", "#b9acd0"], hint: "philosophy, ethics, religion, meaning, big ideas", blurb: "The old questions, still open." },
  { key: "history", name: "History", shades: ["#8c5a2b", "#aa7745", "#633e1a", "#d9b48a"], hint: "history, biography, memoir, how things came to be", blurb: "How we got here, and the people who got us here." },
  { key: "politics", name: "Politics & society", shades: ["#9a3a2e", "#b85a4c", "#6e261d", "#e0a196"], hint: "politics, government, law, geopolitics, society, current affairs, cities", blurb: "Power, policy and how we live together." },
  { key: "culture", name: "Culture", shades: ["#b0447e", "#c9669a", "#82305b", "#e8a9cb"], hint: "fiction and novels, art, film, music, games, media, criticism", blurb: "Stories, art, film, music, games and the things we love." },
  { key: "writing", name: "Writing", shades: ["#b0502d", "#cc7147", "#86381c", "#e6a580"], hint: "writing, language, storytelling, journalism, communication", blurb: "Words, sentences and the craft of saying things clearly." },
  { key: "learning", name: "Learning", shades: ["#2c7a76", "#4c9b94", "#1c5654", "#8cc4bd"], hint: "education, learning, teaching, memory, tools for thought, note-taking", blurb: "How we learn, remember and think with tools." },
  { key: "living", name: "Living", shades: ["#b0841f", "#cda03a", "#835f15", "#e5c97a"], hint: "life, relationships, attention, time, happiness, personal essays, food, travel", blurb: "Attention, time and the rest of life." },
  { key: "unsorted", name: "Unsorted", shades: ["#5d5a55", "#7b776f", "#3f3d39", "#aaa59b"], hint: "", blurb: "Not shelved yet. New arrivals are sorted onto a topic within a day." },
];

export const TOPIC = Object.fromEntries(TOPICS.map((t) => [t.key, t])) as Record<TopicKey, Topic>;
export const isTopic = (v: unknown): v is TopicKey => typeof v === "string" && v in TOPIC;
export const topicOf = (v: unknown): TopicKey => (isTopic(v) ? v : "unsorted");

export type ShelfKind = "book" | ClipKind;

/** One book or clipping as the bookcase sees it: what it is, with your reading laid over it. */
export type ShelfBook = {
  /** The book's or clipping's own id. */
  id: string;
  kind: ShelfKind;
  title: string;
  author: string;
  year?: number;
  /** Its source: a clipping's link, or the book's Goodreads page. */
  url?: string;
  topic: TopicKey;
  minutes: number;
  dek?: string;
  tags: string[];
  favorite: boolean;
  /** 0 to 1. */
  pct: number;
  /** Whether `pct` is measured (from the reader), rather than "reading" on Goodreads. */
  measured: boolean;
  highlights: number;
  /** Epoch ms. */
  added: number;
  /** A picture from the page, shown in the topic's ink. */
  image?: string;
  /** A book's own cover, shown as it is. */
  photo?: string;
  /** A book's own colour, for its cloth. */
  color?: string;
  /** Goodreads stars, 1 to 5. */
  rating?: number;
  /** Saved by an agent or the phone shortcut, rather than on the site. */
  agent: boolean;
  /** The reader's file for it, once known. */
  fileId?: string;
  /** Whether the reader can open it without a file yet: papers with a PDF, articles. */
  readable: boolean;
};

/* ---------- looks ---------- */

/** FNV-1a, then a small PRNG: the same id always gives the same book. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SpineStyle = "bands" | "label" | "sans" | "foil";

export type Look = {
  color: string;
  /** Text and rules on the cloth. */
  fg: string;
  light: boolean;
  style: SpineStyle;
  w: number;
  h: number;
  hue: number;
};

const STYLES: SpineStyle[] = ["bands", "label", "sans", "foil"];

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hueOf(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.08) return 400 + luminance(hex) * 100; // greys after the rainbow
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360 + 20) % 360; // start the rainbow at red
}

const HEX = /^#[0-9a-f]{6}$/i;
const looks = new Map<string, Look>();

export function lookOf(b: Pick<ShelfBook, "id" | "topic" | "minutes" | "color">): Look {
  const key = `${b.id}:${b.topic}:${b.minutes}:${b.color ?? ""}`;
  const hit = looks.get(key);
  if (hit) return hit;
  const r = rng(hash(b.id));
  const shades = TOPIC[b.topic].shades;
  // Mostly the base and deep cloths; the light and pale ones now and then, for rhythm.
  const pick = r();
  const color = b.color && HEX.test(b.color) ? b.color : shades[pick < 0.38 ? 0 : pick < 0.7 ? 2 : pick < 0.88 ? 1 : 3];
  const light = luminance(color) > 0.3;
  const look: Look = {
    color,
    fg: light ? "#2a2520" : "#f6efe2",
    light,
    style: STYLES[Math.floor(r() * STYLES.length)],
    w: Math.round(Math.min(74, Math.max(30, 22 + Math.sqrt(b.minutes) * 4.8))),
    h: Math.round(204 + r() * 54),
    hue: hueOf(color),
  };
  looks.set(key, look);
  return look;
}

/* ---------- pictures ---------- */

export const topicArtSrc = (k: TopicKey) => `/library/topics/${k}.webp`;
export const iconSrc = (k: TopicKey | IconKey) => `/library/icons/${k}.webp`;

/* ---------- shelving ---------- */

export type Sort = "topic" | "recent" | "color" | "length";

export const SORTS: { key: Sort; label: string }[] = [
  { key: "topic", label: "Topic" },
  { key: "recent", label: "Recent" },
  { key: "color", label: "Colour" },
  { key: "length", label: "Length" },
];

const TOPIC_ORDER = Object.fromEntries(TOPICS.map((t, i) => [t.key, i])) as Record<TopicKey, number>;

export function sortBooks(books: ShelfBook[], sort: Sort): ShelfBook[] {
  const by = [...books];
  if (sort === "topic") by.sort((a, b) => TOPIC_ORDER[a.topic] - TOPIC_ORDER[b.topic] || a.added - b.added);
  if (sort === "recent") by.sort((a, b) => b.added - a.added);
  if (sort === "color") by.sort((a, b) => lookOf(a).hue - lookOf(b).hue || lookOf(a).h - lookOf(b).h);
  if (sort === "length") by.sort((a, b) => a.minutes - b.minutes);
  return by;
}

/** The label on the shelf under the first book of each run: a topic, a month or a length. */
export function groupOf(b: ShelfBook, sort: Sort): { key: string; label: string; icon?: TopicKey | IconKey } | null {
  if (sort === "topic") return { key: b.topic, label: TOPIC[b.topic].name, icon: b.topic };
  if (sort === "recent") {
    const label = new Date(b.added).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    return { key: label, label };
  }
  if (sort === "length") {
    if (b.minutes < 10) return { key: "quick", label: "Under 10 min", icon: "quick" };
    if (b.minutes < 30) return { key: "sitting", label: "One sitting" };
    if (b.minutes < 180) return { key: "evening", label: "An evening", icon: "long" };
    return { key: "book", label: "A book", icon: "reading" };
  }
  return null;
}

/* ---------- tags you can filter by ---------- */

/** The clay icons that aren't topics. */
export type IconKey = "favorite" | "reading" | "finished" | "quick" | "long" | "agent";

export type TagKey = IconKey | "books" | "papers" | "articles" | "tweets";

export const TAGS: { key: TagKey; label: string; icon?: IconKey; test: (b: ShelfBook) => boolean }[] = [
  { key: "reading", label: "Reading now", icon: "reading", test: (b) => b.pct > 0 && b.pct < 1 },
  { key: "favorite", label: "Favourites", icon: "favorite", test: (b) => b.favorite },
  { key: "finished", label: "Finished", icon: "finished", test: (b) => b.pct >= 1 },
  { key: "quick", label: "Under 10 min", icon: "quick", test: (b) => b.minutes < 10 },
  { key: "agent", label: "From your phone or agent", icon: "agent", test: (b) => b.agent },
  { key: "books", label: "Books", test: (b) => b.kind === "book" },
  { key: "papers", label: "Papers", test: (b) => b.kind === "paper" },
  { key: "articles", label: "Articles", test: (b) => b.kind === "article" || b.kind === "newsletter" },
  { key: "tweets", label: "Posts", test: (b) => b.kind === "tweet" },
];

/** The tags shown on an open book: what it is to you, not what kind of thing it is. */
export const tagsOf = (b: ShelfBook) => TAGS.filter((t) => t.icon && t.key !== "agent" && t.key !== "quick" && t.test(b));

export const fmtMinutes = (m: number) => (m < 60 ? `${m} min` : m < 600 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${Math.round(m / 60)} h`);

export const hostOf = (url?: string) => {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

/* ---------- what the classifier returns ---------- */

export type Shelving = { topic: TopicKey; tags: string[]; favorite?: boolean; manual?: boolean };

/** Tags: a few short lowercase words, never the topic's own name. */
export function cleanTags(v: unknown, topic: TopicKey): string[] {
  if (!Array.isArray(v)) return [];
  const name = TOPIC[topic].name.toLowerCase();
  const out: string[] = [];
  for (const t of v) {
    if (typeof t !== "string") continue;
    const s = t.toLowerCase().replace(/[^a-z0-9 &+.-]/g, "").replace(/\s+/g, " ").trim();
    if (s.length > 32) continue;
    if (s && s !== name && !out.includes(s)) out.push(s);
    if (out.length === 3) break;
  }
  return out;
}
