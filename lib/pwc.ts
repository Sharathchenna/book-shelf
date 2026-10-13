/**
 * Papers with Code (paperswithcode.co, relaunched by Hugging Face in 2026): ML papers with their
 * code, tasks, methods and leaderboard results. Its public API is anonymous, read-only and in
 * beta (https://paperswithcode.co/docs, schema at /api/v1/openapi.json), and answers browsers
 * from any origin, so the Discover page asks it directly; the server asks it for papers being
 * clipped (lib/clip.ts). Nested lists sometimes arrive as JSON text, so every one is read loosely.
 */

export const PWC = "https://paperswithcode.co";
const API = `${PWC}/api/v1`;

export type PwcTask = { name: string; slug: string };

/** A paper as the site shows it. */
export type PwcPaper = {
  /** Papers with Code's own id; arXiv papers also go by their arXiv id. */
  id: string;
  arxiv?: string;
  /** Where to read it: arXiv, or a blog post or model page for papers that aren't on arXiv. */
  url: string;
  /** Its page on Papers with Code. */
  page: string;
  title: string;
  abstract?: string;
  /** Two sentences on what it does and what it found. */
  tldr?: string;
  authors: string[];
  /** YYYY-MM-DD. */
  published?: string;
  /** A picture of its first page. */
  thumbnail?: string;
  tasks: PwcTask[];
  methods: PwcTask[];
  /** The official implementation, else the most starred. */
  repo?: { url: string; name: string; stars?: number; official: boolean };
  repos: number;
  project?: string;
  /** Leaderboards it places on, best first. */
  ranks: { benchmark: string; rank: number; metric: string }[];
  citations?: number;
  /** Models, datasets and demos built on it, on Hugging Face. */
  hf?: { models: number; datasets: number; spaces: number; url?: string };
};

type Raw = Record<string, unknown>;

const list = (value: unknown): Raw[] => {
  if (typeof value === "string") {
    try {
      return list(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value.filter((v): v is Raw => Boolean(v) && typeof v === "object") : [];
};
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const absolute = (path?: string) => (path && path.startsWith("/") ? `${PWC}${path}` : path);

export function toPwcPaper(raw: Raw): PwcPaper {
  const id = String(raw.id ?? raw.paper_id ?? "");
  const arxiv = text(raw.arxiv_id);
  const repos = list(raw.repositories).map((r) => ({
    url: text(r.url) ?? "",
    name: [text(r.owner), text(r.name)].filter(Boolean).join("/"),
    stars: count(r.num_stars),
    official: r.is_official === true,
  }));
  // The trending feed names one repository instead of listing them.
  const single = list([raw.repository]).map((r) => ({
    url: text(r.url) ?? "",
    name: [text(r.owner), text(r.name)].filter(Boolean).join("/"),
    stars: count(r.num_stars),
    official: raw.has_official_implementation === true,
  }));
  const repo = [...repos, ...single]
    .filter((r) => r.url)
    .sort((a, b) => Number(b.official) - Number(a.official) || (b.stars ?? 0) - (a.stars ?? 0))[0];
  const hf = raw.hf_artifact_summary as Raw | null | undefined;
  return {
    id,
    arxiv,
    url: (arxiv ? `https://arxiv.org/abs/${arxiv}` : text(raw.source_url) ?? text(raw.url_abs)) ?? `${PWC}/paper/${id}`,
    page: `${PWC}/paper/${arxiv ?? id}`,
    title: text(raw.title) ?? "Untitled",
    // Some abstracts arrive still wrapped in the quotes of the CSV they came from.
    abstract: text(raw.abstract)?.replace(/^"([\s\S]*?)"?$/, "$1"),
    tldr: text(raw.tldr),
    authors: Array.isArray(raw.authors) ? raw.authors.filter((a): a is string => typeof a === "string") : [],
    published: text(raw.published ?? raw.date_published)?.slice(0, 10),
    thumbnail: absolute(text(raw.thumbnail_url)),
    tasks: list(raw.tasks).flatMap((t) => (text(t.name) && text(t.slug) ? [{ name: text(t.name)!, slug: text(t.slug)! }] : [])),
    methods: list(raw.methods).flatMap((m) => (text(m.name) && text(m.slug) ? [{ name: text(m.name)!, slug: text(m.slug)! }] : [])),
    repo,
    repos: count(raw.code_repository_count) ?? repos.length,
    project: list(raw.project_pages).map((p) => text(p.url)).find(Boolean),
    ranks: list(raw.leaderboard_ranks)
      .flatMap((r) => {
        const rank = count(r.best_rank);
        const benchmark = text(r.dataset_name);
        return rank && benchmark ? [{ benchmark, rank, metric: text(r.best_metric) ?? "" }] : [];
      })
      .sort((a, b) => a.rank - b.rank),
    citations: count(raw.citation_count),
    hf:
      hf && typeof hf === "object"
        ? { models: count(hf.model_count) ?? 0, datasets: count(hf.dataset_count) ?? 0, spaces: count(hf.space_count) ?? 0, url: text(hf.best_url) }
        : undefined,
  };
}

export type PwcQuery = {
  order?: "trending" | "date_published" | "citation_count";
  search?: string;
  task?: string;
  hasCode?: boolean;
  page?: number;
  pageSize?: number;
  /** Only papers published on or after this day (YYYY-MM-DD). */
  since?: string;
};

/** One page of papers, with everything the cards show. */
export async function pwcPapers(query: PwcQuery, init?: RequestInit): Promise<{ papers: PwcPaper[]; total: number; next?: number }> {
  const params = new URLSearchParams({
    order_by: query.order ?? "trending",
    page: String(query.page ?? 1),
    page_size: String(query.pageSize ?? 24),
    include_resources: "true",
  });
  if (query.search) params.set("search", query.search);
  if (query.task) params.set("task", query.task);
  if (query.hasCode) params.set("has_code", "true");
  if (query.since) params.set("start_date", query.since);
  const res = await fetch(`${API}/papers/?${params}`, init);
  if (!res.ok) throw new Error(res.status === 429 ? "Papers with Code is busy; try again in a minute." : `Papers with Code answered ${res.status}.`);
  const body = (await res.json()) as { results?: Raw[]; count?: number; next_page?: number | null };
  return { papers: list(body.results).map(toPwcPaper), total: body.count ?? 0, next: body.next_page ?? undefined };
}

/** The most studied tasks, for filtering. */
export async function pwcTasks(init?: RequestInit): Promise<PwcTask[]> {
  const res = await fetch(`${API}/tasks/?page_size=24&ordering=-paper_count`, init);
  if (!res.ok) return [];
  const body = (await res.json()) as { results?: Raw[] };
  return list(body.results).flatMap((t) => (text(t.name) && text(t.slug) ? [{ name: text(t.name)!, slug: text(t.slug)! }] : []));
}

/** One arXiv paper, or null when Papers with Code doesn't have it. */
export async function pwcByArxiv(arxiv: string, init?: RequestInit): Promise<PwcPaper | null> {
  const res = await fetch(`${API}/papers/arxiv/${encodeURIComponent(arxiv)}?include_resources=true`, init);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Papers with Code answered ${res.status}.`);
  return toPwcPaper((await res.json()) as Raw);
}
