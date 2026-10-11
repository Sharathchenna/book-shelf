"use client";

import { useState } from "react";
import { CLIP_LABEL } from "@/lib/clippings";
import { fallbackColor, textOn } from "@/lib/color";
import type { Clip, ClipKind } from "@/lib/types";

const PAGE_SIZE = 6;

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const date = (iso: string, format = monthYear) => format.format(new Date(`${iso}T00:00:00Z`));

const SECTIONS: Record<ClipKind, { blurb: (items: Clip[]) => string; list: string; Card: (props: { clip: Clip }) => React.ReactNode }> = {
  article: {
    blurb: () => "Essays and long reads from around the web, with notes in the margins.",
    // Masonry: cards with and without images keep their natural heights.
    list: "columns-1 gap-4 sm:columns-2 lg:columns-3 [&>li]:mb-4 [&>li]:break-inside-avoid",
    Card: ArticleCard,
  },
  newsletter: {
    blurb: (items) => {
      const publications = new Set(items.map((c) => c.source)).size;
      return `Issues worth keeping from ${publications} ${publications === 1 ? "publication" : "publications"} in the inbox.`;
    },
    list: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>li>a]:h-full",
    Card: NewsletterCard,
  },
  tweet: {
    blurb: () => "Posts that stuck, kept here in case they disappear.",
    list: "columns-1 gap-4 sm:columns-2 lg:columns-3 [&>li]:mb-4 [&>li]:break-inside-avoid",
    Card: TweetCard,
  },
};

/** One section per kind of clipping (articles, newsletters, tweets), each with its own card and layout. */
export function ClipSection({ kind, items }: { kind: ClipKind; items: Clip[] }) {
  const [expanded, setExpanded] = useState(false);
  const { blurb, list, Card } = SECTIONS[kind];
  const label = CLIP_LABEL[kind];
  const shown = expanded ? items : items.slice(0, PAGE_SIZE);

  return (
    <section id={label.toLowerCase()} aria-labelledby={`${kind}-title`} className="scroll-mt-28">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id={`${kind}-title`} className="font-serif text-4xl">
            {label}
            <span className="ml-3 align-middle font-sans text-sm text-muted">{items.length}</span>
          </h2>
          <p className="mt-1 text-sm text-muted">{blurb(items)}</p>
        </div>
      </div>

      <ul className={`mt-6 ${list}`}>
        {shown.map((clip) => (
          <li key={clip.id}>
            <a
              href={clip.url}
              target="_blank"
              rel="noreferrer"
              className="glass block overflow-hidden rounded-3xl transition-transform duration-300 hover:-translate-y-1 focus-visible:-translate-y-1"
            >
              <Card clip={clip} />
            </a>
          </li>
        ))}
      </ul>

      {items.length > PAGE_SIZE && (
        <div className="mt-2 flex justify-center">
          <button onClick={() => setExpanded((v) => !v)} className="pill">
            {expanded ? "Show fewer" : `Show all ${items.length} ${label.toLowerCase()}`}
          </button>
        </div>
      )}
    </section>
  );
}

function ArticleCard({ clip }: { clip: Clip }) {
  return (
    <>
      {clip.image && <Picture src={clip.image} className="aspect-[1.91] w-full object-cover" />}
      <div className="p-5">
        <p className="flex items-center gap-2 text-xs text-muted">
          <Monogram name={clip.source} />
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
      <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-line">
        <Linkified text={tweet.text} />
      </p>
      {tweet.media.length > 0 && (
        <div className={`mt-3 grid gap-1 overflow-hidden rounded-2xl ring-1 ring-line ${tweet.media.length > 1 ? "grid-cols-2" : ""}`}>
          {tweet.media.slice(0, 4).map((src) => (
            <Picture key={src} src={src} className="aspect-[4/3] w-full object-cover" />
          ))}
        </div>
      )}
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
