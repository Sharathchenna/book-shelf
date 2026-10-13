"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fallbackColor, textOn } from "@/lib/color";
import type { Clip, ClipKind } from "@/lib/types";
import { useOwner } from "./use-owner";

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const date = (iso: string, format = monthYear) => format.format(new Date(`${iso}T00:00:00Z`));

// The card link (first child) fills the grid cell; the small links beside it must not.
const LAYOUT: Record<ClipKind, { list: string; Card: (props: { clip: Clip; readable?: boolean }) => React.ReactNode }> = {
  // Masonry: cards with and without images keep their natural heights.
  article: { list: "columns-1 gap-4 sm:columns-2 lg:columns-3 [&>li]:mb-4 [&>li]:break-inside-avoid", Card: ArticleCard },
  // Two wide columns: titles and abstracts need the measure.
  paper: { list: "grid grid-cols-1 gap-4 md:grid-cols-2 [&>li>a:first-child]:h-full", Card: PaperCard },
  // An even grid, so the letter-style cards and their postmarks line up.
  newsletter: { list: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>li>a:first-child]:h-full", Card: NewsletterCard },
  tweet: { list: "columns-1 gap-4 sm:columns-2 lg:columns-3 [&>li]:mb-4 [&>li]:break-inside-avoid", Card: TweetCard },
};

/** Every clipping of one kind, each with that kind's card. */
export function ClipGrid({ kind, items }: { kind: ClipKind; items: Clip[] }) {
  const { list, Card } = LAYOUT[kind];
  // The owner can remove clippings, and open papers with a free PDF, and X Articles, in the reader.
  const owner = useOwner();
  const router = useRouter();
  const remove = async (clip: Clip) => {
    if (!confirm(`Remove “${clip.title ?? clip.url}”?`)) return;
    const res = await fetch("/api/clips", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: clip.id }),
    });
    if (res.ok) router.refresh();
  };
  return (
    <ul className={list}>
      {items.map((clip) => {
        // For the owner, a paper with a free PDF or an X Article opens in the site's reader; the source is a small link.
        const reader = !owner ? null : clip.paper?.pdf ? `/reader/paper/${encodeURIComponent(clip.id)}` : clip.xArticle ? `/reader/clip/${encodeURIComponent(clip.id)}` : null;
        const readable = Boolean(reader);
        const cardClass =
          "glass block overflow-hidden rounded-3xl transition-transform duration-300 hover:-translate-y-1 focus-visible:-translate-y-1";
        return (
          <li key={clip.id} className="group relative">
            {reader ? (
              <Link href={reader} className={cardClass}>
                <Card clip={clip} readable />
              </Link>
            ) : (
              <a href={clip.url} target="_blank" rel="noreferrer" className={cardClass}>
                <Card clip={clip} />
              </a>
            )}
            {owner && (
              <button
                onClick={() => void remove(clip)}
                aria-label={`Remove ${clip.title ?? "this clipping"}`}
                title="Remove"
                className="absolute top-3 right-3 grid size-8 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
            {(readable || clip.paper?.pwc?.repo) && (
              <span className="absolute right-5 bottom-5 flex gap-1.5 text-xs">
                {clip.paper?.pwc?.repo && <CodeLink repo={clip.paper.pwc.repo} />}
                {readable && (
                  <a href={clip.url} target="_blank" rel="noreferrer" className="rounded-md border border-line px-1.5 py-0.5 text-muted transition-colors hover:text-fg">
                    {clip.paper?.arxiv ? "arXiv" : clip.xArticle ? "X" : new URL(clip.url).host.replace(/^www\./, "")} ↗
                  </a>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ArticleCard({ clip }: { clip: Clip }) {
  return (
    <>
      {clip.image && <Picture src={clip.image} className="aspect-[1.91] w-full object-cover" />}
      <div className="p-5">
        <p className="flex items-center gap-2 text-xs text-muted">
          {clip.xArticle?.avatar ? (
            <Picture src={clip.xArticle.avatar} className="size-5 rounded-full bg-chip" fallback={<Monogram name={clip.source} />} />
          ) : (
            <Monogram name={clip.source} />
          )}
          <span className="truncate font-medium text-fg/80">{clip.source}</span>
          {clip.minutes && <span className="shrink-0">· {clip.minutes} min read</span>}
        </p>
        <h3 className="mt-3 font-serif text-xl leading-snug text-balance">{clip.title}</h3>
        {clip.excerpt && <p className="mt-2 line-clamp-3 text-sm text-muted">{clip.excerpt}</p>}
        <Note text={clip.note} />
        <Byline parts={[clip.author !== clip.source && clip.author, clip.published && date(clip.published)]} />
      </div>
    </>
  );
}

/** A paper's code on GitHub, with its stars: beside the card, since the card is a link itself. */
export function CodeLink({ repo }: { repo: NonNullable<NonNullable<NonNullable<Clip["paper"]>["pwc"]>["repo"]> }) {
  return (
    <a
      href={repo.url}
      target="_blank"
      rel="noreferrer"
      title={`${repo.name}${repo.official ? " (official code)" : ""}`}
      className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-muted transition-colors hover:text-fg"
    >
      <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />
      </svg>
      Code{repo.stars ? <span className="tabular-nums">★ {compact.format(repo.stars)}</span> : null} ↗
    </a>
  );
}

/** Styled like a title page: venue and year, title, authors, then what it found (or the abstract). */
/** `readable`: opens in the site's reader (the owner, with a free PDF). */
function PaperCard({ clip, readable }: { clip: Clip; readable?: boolean }) {
  const paper = clip.paper!;
  const shown = paper.authors.slice(0, 4);
  const more = paper.authors.length - shown.length;
  const code = paper.pwc;
  const best = code?.sota?.[0];
  return (
    <div className="flex h-full flex-col p-6">
      <p className="flex items-baseline justify-between gap-3 text-[11px] font-medium tracking-[0.14em] text-muted uppercase">
        <span className="truncate">{clip.source}</span>
        {paper.year && <span className="shrink-0 font-serif text-sm tracking-normal normal-case italic">{paper.year}</span>}
      </p>
      <h3 className="mt-3 font-serif text-xl leading-snug text-balance">{clip.title}</h3>
      {shown.length > 0 && (
        <p className="mt-2 text-sm text-fg/80">
          {shown.join(", ")}
          {more > 0 && <span className="text-muted"> + {more} more</span>}
        </p>
      )}
      {(code?.tasks.length || best) && (
        <p className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted">
          {best && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent" title={`${best.metric} on ${best.benchmark}`}>
              #{best.rank} on {best.benchmark}
            </span>
          )}
          {code?.tasks.slice(0, 3).map((task) => (
            <span key={task.slug} className="rounded-full bg-chip px-2 py-0.5">
              {task.name}
            </span>
          ))}
        </p>
      )}
      {(code?.tldr ?? clip.excerpt) && <p className="mt-3 line-clamp-4 text-sm text-muted">{code?.tldr ?? clip.excerpt}</p>}
      <Note text={clip.note} />
      <p className={`mt-auto flex flex-wrap items-center gap-2 pt-4 text-xs text-muted ${code?.repo ? "pb-8" : ""}`}>
        {paper.arxiv && <span className="rounded-md bg-chip px-1.5 py-0.5 font-mono">arXiv:{paper.arxiv}</span>}
        {!paper.arxiv && paper.doi && <span className="truncate rounded-md bg-chip px-1.5 py-0.5 font-mono">doi:{paper.doi}</span>}
        {readable ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-ink px-2 py-0.5 font-medium text-ink-fg">
            <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden>
              <path d="M12 7c-2-1.5-5-2-8-1.5v12c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-12c-3-.5-6 0-8 1.5zM12 7v12" />
            </svg>
            Read here
          </span>
        ) : (
          paper.pdf && <span className="rounded-md border border-line px-1.5 py-0.5 font-medium">PDF</span>
        )}
      </p>
    </div>
  );
}

/** Styled like a letter: the publication up top, and a postmark with the issue date. */
function NewsletterCard({ clip }: { clip: Clip }) {
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3 border-b border-dashed border-line pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <Monogram name={clip.source} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-serif text-lg leading-tight italic">{clip.source}</p>
            <p className="text-[11px] font-medium tracking-[0.14em] text-muted uppercase">Newsletter</p>
          </div>
        </div>
        {clip.published && (
          <span
            aria-label={`Sent ${date(clip.published, fullDate)}`}
            className="grid size-14 shrink-0 -rotate-12 place-items-center rounded-full border border-dashed border-accent/60 text-center text-[9px] leading-tight font-semibold tracking-wider whitespace-pre-line text-accent uppercase"
          >
            {date(clip.published).replace(" ", "\n")}
          </span>
        )}
      </div>
      <h3 className="mt-4 font-serif text-xl leading-snug text-balance">{clip.title}</h3>
      {clip.excerpt && <p className="mt-2 line-clamp-3 text-sm text-muted">{clip.excerpt}</p>}
      <Note text={clip.note} />
      <Byline parts={[clip.author, clip.minutes && `${clip.minutes} min read`]} />
    </div>
  );
}

function TweetCard({ clip }: { clip: Clip }) {
  const tweet = clip.tweet!;
  return (
    <div className="p-5">
      <div className="flex items-center gap-3">
        {tweet.avatar ? (
          <Picture src={tweet.avatar} className="size-10 rounded-full bg-chip" fallback={<Monogram name={tweet.name} size="avatar" />} />
        ) : (
          <Monogram name={tweet.name} size="avatar" />
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-semibold">{tweet.name}</p>
          <p className="truncate text-sm text-muted">@{tweet.handle}</p>
        </div>
        <svg viewBox="0 0 24 24" aria-label="X" className="size-4 shrink-0 fill-current opacity-70">
          <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.18h1.7L7.4 4.74H5.58l11.09 14.44Z" />
        </svg>
      </div>
      {tweet.replyTo && (
        <p className="mt-3 line-clamp-2 border-l-2 border-line pl-3 text-sm text-muted">
          Replying to <span className="text-accent">@{tweet.replyTo.handle}</span>: {tweet.replyTo.text}
        </p>
      )}
      {/* Long posts are kept whole for search; the card shows the start. */}
      <p className="mt-3 line-clamp-[14] text-[15px] leading-relaxed whitespace-pre-line">
        <Linkified text={tweet.text} />
      </p>
      {tweet.media.length > 0 && (
        <div className={`mt-3 grid gap-1 overflow-hidden rounded-2xl ring-1 ring-line ${tweet.media.length > 1 ? "grid-cols-2" : ""}`}>
          {tweet.media.slice(0, 4).map((src) => (
            <Picture key={src} src={src} className="aspect-[4/3] w-full object-cover" />
          ))}
        </div>
      )}
      {tweet.quote && <QuotedPost post={tweet.quote} />}
      <Note text={clip.note} />
      <Byline
        parts={[
          clip.published && date(clip.published, fullDate),
          tweet.likes !== undefined && `♥ ${compact.format(tweet.likes)}`,
        ]}
      />
    </div>
  );
}

/** The post a tweet quotes, as a smaller card inside it. */
function QuotedPost({ post }: { post: NonNullable<NonNullable<Clip["tweet"]>["quote"]> }) {
  return (
    <div className="mt-3 rounded-2xl p-3.5 ring-1 ring-line">
      <p className="truncate text-sm">
        <span className="font-semibold">{post.name}</span> <span className="text-muted">@{post.handle}</span>
      </p>
      <p className="mt-1 line-clamp-5 text-sm leading-relaxed whitespace-pre-line">
        <Linkified text={post.text} />
      </p>
      {post.media?.[0] && <Picture src={post.media[0]} className="mt-2 aspect-[16/9] w-full rounded-xl object-cover" />}
    </div>
  );
}

/** Mentions, hashtags and links highlighted. Not anchors: the whole card is already a link. */
function Linkified({ text }: { text: string }) {
  return text.split(/(https?:\/\/\S+|[@#]\w+)/g).map((part, i) =>
    i % 2 ? (
      <span key={i} className="text-accent">
        {part.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
      </span>
    ) : (
      part
    ),
  );
}

function Note({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="mt-4 border-l-2 border-accent pl-3 font-serif text-[15px] leading-snug italic">{text}</p>;
}

function Byline({ parts }: { parts: (string | number | false | undefined)[] }) {
  const shown = parts.filter(Boolean);
  if (shown.length === 0) return null;
  return <p className="mt-4 text-xs text-muted">{shown.join(" · ")}</p>;
}

function Monogram({ name, size = "sm" }: { name: string; size?: "sm" | "lg" | "avatar" }) {
  const color = fallbackColor(name);
  const sizes = { sm: "size-5 rounded-md text-[11px]", lg: "size-10 rounded-xl text-lg", avatar: "size-10 rounded-full text-base" };
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center font-serif ${sizes[size]}`}
      style={{ backgroundColor: color, color: textOn(color) }}
    >
      {name.replace(/^(the|a)\s+/i, "")[0]?.toUpperCase()}
    </span>
  );
}

/** A remote image that quietly disappears (or shows a fallback) when the host refuses it. */
function Picture({ src, className, fallback = null }: { src: string; className?: string; fallback?: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={className} />
  );
}
