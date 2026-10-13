"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { pwcPapers, pwcTasks, type PwcPaper, type PwcTask } from "@/lib/pwc";
import { useOwner } from "../use-owner";

type Feed = "for-you" | "trending" | "latest";

const FEEDS: { feed: Feed; label: string }[] = [
  { feed: "for-you", label: "For you" },
  { feed: "trending", label: "Trending" },
  { feed: "latest", label: "Latest" },
];
/** How many of the reader's own tasks "For you" draws on, and papers per task per page. */
const OWN_TASKS = 4;
const PER_TASK = 10;

const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** The id a paper is clipped under (lib/clip.ts), and so the reader's address for it. */
const clipIdOf = (arxiv: string) => `arxiv-${arxiv.replace("/", "-")}`;

/**
 * New papers from Papers with Code, for the owner: papers trending in the tasks of the papers
 * they've saved, everything trending (by how fast its code is gaining stars), or the latest,
 * filtered by task or searched. Each one can be saved to the shelf, or saved and opened in the
 * reader, where Explain, Recap and Chat help with the hard parts. The feed and filters live in
 * the address, so Back returns to the same list.
 */
export function PaperDiscover({ saved: savedIds, ownTasks }: { saved: string[]; ownTasks: PwcTask[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const task = params.get("task") ?? "";
  const withCode = params.get("code") !== "any";
  const requested = params.get("feed") as Feed | null;
  const feed: Feed = requested && FEEDS.some((f) => f.feed === requested) ? requested : ownTasks.length ? "for-you" : "trending";
  // "For you" follows the reader's own tasks; a search or a chosen task is a plain feed.
  const personal = feed === "for-you" && !q && !task && ownTasks.length > 0;

  // The list for the current feed and filters; anything else on screen is from before they changed.
  const key = JSON.stringify([personal, feed, q, task, withCode]);
  const [result, setResult] = useState<{ key: string; papers: PwcPaper[]; page: number; next?: number; total?: number; error?: string } | null>(null);
  const [more, setMore] = useState(false);
  const [retries, setRetries] = useState(0);
  const [tasks, setTasks] = useState<PwcTask[]>([]);
  const [saved, setSaved] = useState(() => new Set(savedIds));
  const [draft, setDraft] = useState(q);

  const go = useCallback(
    (patch: Record<string, string | undefined>) => {
      const nextParams = new URLSearchParams(params);
      for (const [name, value] of Object.entries(patch)) {
        if (value) nextParams.set(name, value);
        else nextParams.delete(name);
      }
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const fetchPage = useCallback(
    async (page: number): Promise<{ papers: PwcPaper[]; total?: number; next?: number }> => {
      if (!personal) {
        return pwcPapers({ order: feed === "latest" ? "date_published" : "trending", search: q || undefined, task: task || undefined, hasCode: withCode, page });
      }
      // Trending in each of the reader's tasks, taken in turns so no one task fills the page.
      const pages = await Promise.all(
        ownTasks.slice(0, OWN_TASKS).map((t) => pwcPapers({ order: "trending", task: t.slug, hasCode: withCode, page, pageSize: PER_TASK }).catch(() => null)),
      );
      if (pages.every((p) => !p)) throw new Error("Couldn't reach Papers with Code.");
      const mixed: PwcPaper[] = [];
      for (let i = 0; i < PER_TASK; i++) for (const p of pages) if (p?.papers[i]) mixed.push(p.papers[i]);
      return { papers: mixed, next: pages.some((p) => p?.next) ? page + 1 : undefined };
    },
    [personal, ownTasks, withCode, feed, q, task],
  );

  useEffect(() => {
    let current = true;
    fetchPage(1).then(
      (found) => current && setResult({ key, ...found, papers: unique(found.papers), page: 1 }),
      (err: Error) => current && setResult({ key, papers: [], page: 1, error: err.message }),
    );
    return () => {
      current = false;
    };
  }, [fetchPage, key, retries]);

  const shown = result?.key === key ? result : null;
  const papers = shown?.papers ?? [];
  const loading = !shown || more;
  const error = shown?.error ?? "";
  const showMore = async () => {
    if (!shown) return;
    setMore(true);
    try {
      const found = await fetchPage(shown.page + 1);
      setResult((r) => (r?.key === key ? { ...r, papers: unique([...r.papers, ...found.papers]), page: shown.page + 1, next: found.next } : r));
    } catch {
      // The button stays; another press tries again.
    } finally {
      setMore(false);
    }
  };

  // The search box follows the address when Back or a cleared search changes it.
  const [shownQ, setShownQ] = useState(q);
  if (q !== shownQ) {
    setShownQ(q);
    setDraft(q);
  }
  useEffect(() => {
    void pwcTasks().then(setTasks);
  }, []);

  // The reader's own tasks first, then the most studied ones.
  const own = new Set(ownTasks.map((t) => t.slug));
  const chips = [...ownTasks, ...tasks.filter((t) => !own.has(t.slug))].slice(0, 24);
  const chosen = task && !chips.some((t) => t.slug === task) ? [{ slug: task, name: task.replaceAll("-", " ") }, ...chips] : chips;

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-fit rounded-full bg-chip p-1">
          {FEEDS.filter((f) => f.feed !== "for-you" || ownTasks.length).map(({ feed: f, label }) => (
            <button
              key={f}
              onClick={() => go({ feed: f, q: undefined, task: undefined })}
              aria-pressed={feed === f && (f !== "for-you" || personal)}
              className="rounded-full px-4 py-1.5 text-sm font-medium text-muted transition-all hover:text-fg aria-pressed:bg-bg aria-pressed:text-fg aria-pressed:shadow-sm"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              go({ q: draft.trim() || undefined, feed: feed === "for-you" ? "trending" : feed });
            }}
            className="glass flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full px-4 lg:w-80"
          >
            <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search titles and abstracts"
              aria-label="Search papers"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
            {q && (
              <button type="button" onClick={() => go({ q: undefined })} aria-label="Clear search" className="text-muted hover:text-fg">
                ×
              </button>
            )}
          </form>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={withCode} onChange={(e) => go({ code: e.target.checked ? undefined : "any" })} className="accent-accent" />
            With code
          </label>
        </div>
      </div>

      {chosen.length > 0 && (
        <div className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {chosen.map((t) => (
            <button
              key={t.slug}
              onClick={() => go({ task: task === t.slug ? undefined : t.slug, feed: feed === "for-you" ? "trending" : feed })}
              aria-pressed={task === t.slug}
              className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted capitalize transition-colors hover:text-fg aria-pressed:border-transparent aria-pressed:bg-ink aria-pressed:text-ink-fg"
            >
              {own.has(t.slug) && <span className="mr-1 text-accent">•</span>}
              {t.name}
            </button>
          ))}
        </div>
      )}

      <p className="mt-6 text-sm text-muted">
        {personal
          ? `Trending in what you read: ${ownTasks
              .slice(0, OWN_TASKS)
              .map((t) => t.name)
              .join(", ")}.`
          : [
              feed === "latest" ? "Newest first" : "Trending, by how fast their code is gaining stars",
              q && `matching “${q}”`,
              task && `in ${chosen.find((t) => t.slug === task)?.name ?? task}`,
              shown?.total !== undefined && `${compact.format(shown.total)} papers`,
            ]
              .filter(Boolean)
              .join(" · ")}
      </p>

      {error && (
        <p className="mt-6 rounded-3xl border border-dashed border-line px-6 py-10 text-center text-muted">
          {error}{" "}
          <button onClick={() => setRetries((n) => n + 1)} className="underline underline-offset-4 hover:text-fg">
            Try again
          </button>
        </p>
      )}

      <ul className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {papers.map((paper) => (
          <li key={paper.id}>
            <PaperResult
              paper={paper}
              saved={Boolean(paper.arxiv && saved.has(clipIdOf(paper.arxiv)))}
              onSaved={(clipId) => setSaved((before) => new Set(before).add(clipId))}
              onTask={(slug) => go({ task: slug, feed: feed === "for-you" ? "trending" : feed })}
            />
          </li>
        ))}
        {loading &&
          Array.from({ length: papers.length ? 2 : 6 }, (_, i) => (
            <li key={`loading-${i}`} className="h-64 animate-pulse rounded-3xl bg-chip" aria-hidden />
          ))}
      </ul>

      {!loading && !error && papers.length === 0 && (
        <p className="rounded-3xl border border-dashed border-line px-6 py-16 text-center text-muted">No papers found.</p>
      )}
      {!loading && shown?.next && (
        <div className="mt-10 text-center">
          <button
            onClick={() => void showMore()}
            className="pill"
          >
            Show more
          </button>
        </div>
      )}
      <p className="mt-12 text-center text-xs text-muted">
        From{" "}
        <a href="https://paperswithcode.co" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-fg">
          Papers with Code
        </a>
        .
      </p>
    </div>
  );
}

/** Papers once each: a paper can trend in two tasks, or move between pages. */
function unique(papers: PwcPaper[]): PwcPaper[] {
  const seen = new Set<string>();
  return papers.filter((p) => !seen.has(p.id) && seen.add(p.id));
}

/** One paper: its first page, what it found, its code and standing, and Read / Save. */
function PaperResult({
  paper,
  saved,
  onSaved,
  onTask,
}: {
  paper: PwcPaper;
  saved: boolean;
  onSaved: (clipId: string) => void;
  onTask: (slug: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "save" | "read">("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [noThumbnail, setNoThumbnail] = useState(false);
  const shown = paper.authors.slice(0, 3);
  const more = paper.authors.length - shown.length;
  const best = paper.ranks.find((r) => r.rank <= 3);
  const artifacts = paper.hf ? paper.hf.models + paper.hf.datasets + paper.hf.spaces : 0;

  const save = async (then?: "read") => {
    if (!paper.arxiv) return;
    const clipId = clipIdOf(paper.arxiv);
    setBusy(then ?? "save");
    setError("");
    try {
      if (!saved) {
        const res = await fetch("/api/clips", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: `https://arxiv.org/abs/${paper.arxiv}`, kind: "paper" }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Couldn't save it.");
        onSaved(clipId);
      }
      if (then === "read") router.push(`/reader/paper/${encodeURIComponent(clipId)}`);
      else setBusy("");
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
    }
  };

  return (
    <article className="glass flex h-full overflow-hidden rounded-3xl">
      {paper.thumbnail && !noThumbnail && (
        // The first page, whole, at the top of a paper-white column.
        <a href={paper.page} target="_blank" rel="noreferrer" className="hidden w-36 shrink-0 border-r border-line bg-white sm:block" aria-hidden tabIndex={-1}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={paper.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setNoThumbnail(true)} className="w-full" />
        </a>
      )}
      <div className="flex min-w-0 flex-1 flex-col p-5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {paper.published && <span>{day.format(new Date(`${paper.published}T00:00:00Z`))}</span>}
          {paper.citations ? <span>· {compact.format(paper.citations)} citations</span> : null}
          {best && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent" title={`${best.metric} on ${best.benchmark}`}>
              #{best.rank} on {best.benchmark}
            </span>
          )}
        </p>
        <h3 className="mt-2 font-serif text-xl leading-snug text-balance">
          <a href={paper.page} target="_blank" rel="noreferrer" className="hover:underline hover:decoration-line hover:underline-offset-4">
            {paper.title}
          </a>
        </h3>
        {shown.length > 0 && (
          <p className="mt-1 truncate text-sm text-fg/80">
            {shown.join(", ")}
            {more > 0 && <span className="text-muted"> + {more} more</span>}
          </p>
        )}
        {paper.tasks.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-1.5">
            {paper.tasks.slice(0, 3).map((t) => (
              <button key={t.slug} onClick={() => onTask(t.slug)} className="rounded-full bg-chip px-2 py-0.5 text-[11px] text-muted transition-colors hover:text-fg">
                {t.name}
              </button>
            ))}
          </p>
        )}
        {(paper.tldr ?? paper.abstract) && (
          <p className={`mt-3 text-sm text-muted ${open ? "" : "line-clamp-4"}`}>{open ? (paper.abstract ?? paper.tldr) : (paper.tldr ?? paper.abstract)}</p>
        )}
        {paper.abstract && paper.tldr && (
          <button onClick={() => setOpen(!open)} className="mt-1 self-start text-xs text-muted underline-offset-4 hover:text-fg hover:underline">
            {open ? "Show the summary" : "Read the abstract"}
          </button>
        )}
        {open && paper.methods.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            Methods:{" "}
            {paper.methods.slice(0, 6).map((m, i) => (
              <span key={m.slug}>
                {i > 0 && ", "}
                <a href={`https://paperswithcode.co/methods/${m.slug}`} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">
                  {m.name}
                </a>
              </span>
            ))}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4 text-xs">
          {paper.arxiv ? (
            <>
              <button
                onClick={() => void save("read")}
                disabled={Boolean(busy)}
                className="inline-flex items-center gap-1 rounded-md bg-ink px-2 py-1 font-medium text-ink-fg disabled:opacity-60"
              >
                <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden>
                  <path d="M12 7c-2-1.5-5-2-8-1.5v12c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-12c-3-.5-6 0-8 1.5zM12 7v12" />
                </svg>
                {busy === "read" ? (saved ? "Opening…" : "Saving…") : "Read"}
              </button>
              <button
                onClick={() => void save()}
                disabled={saved || Boolean(busy)}
                className="rounded-md border border-line px-2 py-1 font-medium text-muted transition-colors enabled:hover:text-fg disabled:opacity-80"
              >
                {saved ? "✓ Saved" : busy === "save" ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <a href={paper.url} target="_blank" rel="noreferrer" className="rounded-md border border-line px-2 py-1 font-medium text-muted hover:text-fg">
              {new URL(paper.url).host.replace(/^www\./, "")} ↗
            </a>
          )}
          {paper.repo && (
            <a
              href={paper.repo.url}
              target="_blank"
              rel="noreferrer"
              title={`${paper.repo.name}${paper.repo.official ? " (official)" : ""}${paper.repos > 1 ? ` · ${paper.repos} implementations` : ""}`}
              className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-muted transition-colors hover:text-fg"
            >
              <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />
              </svg>
              Code
              {paper.repo.stars ? <span className="tabular-nums">★ {compact.format(paper.repo.stars)}</span> : null}
            </a>
          )}
          {artifacts > 0 && paper.hf?.url && (
            <a href={paper.hf.url} target="_blank" rel="noreferrer" title={`${paper.hf.models} models, ${paper.hf.datasets} datasets, ${paper.hf.spaces} demos`} className="rounded-md border border-line px-2 py-1 text-muted transition-colors hover:text-fg">
              🤗 {artifacts}
            </a>
          )}
          {paper.project && (
            <a href={paper.project} target="_blank" rel="noreferrer" className="rounded-md border border-line px-2 py-1 text-muted transition-colors hover:text-fg">
              Project ↗
            </a>
          )}
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </article>
  );
}

/** "Discover" beside the Papers heading, for the owner. */
export function DiscoverLink() {
  if (!useOwner()) return null;
  return (
    <Link href="/papers/discover" className="pill">
      Discover new papers →
    </Link>
  );
}
