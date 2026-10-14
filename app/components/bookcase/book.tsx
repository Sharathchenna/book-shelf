"use client";

import { memo, useState } from "react";
import { iconSrc, lookOf, TOPIC, topicArtSrc, type IconKey, type Look, type ShelfBook, type TopicKey } from "@/lib/bookcase";

/** One of the bookcase's own emoji: a small clay figure for a topic or a tag. */
export function Glyph({ k, size = 18, className = "" }: { k: TopicKey | IconKey; size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={iconSrc(k)} alt="" width={size} height={size} draggable={false} decoding="async" className={`glyph ${className}`} />;
}

const lastName = (a: string) => a.replace(/^@/, "").split(/&|,| and | et al\./)[0].trim().split(/\s+/).slice(-1)[0] || a;

/** A book seen end-on: cloth, a title running down it, the author at the foot. */
export const Spine = memo(function Spine({ book, look = lookOf(book) }: { book: ShelfBook; look?: Look }) {
  const { w, h, color, fg, style } = look;
  const t = TOPIC[book.topic];
  const wide = w >= 52;
  const by = lastName(book.author);
  // The author across the foot, as large as fits; on a spine too slim for the
  // whole name, it runs down after the title instead of being cut off.
  const bySize = Math.min(11, w * 0.22, (w - 12) / Math.max(1, by.length * 0.56));
  const narrow = w < 44 || bySize < 8;
  // Fit the title down the spine: shrink a long one, within reason, before it is cut short.
  const per = style === "sans" ? 0.54 : 0.5;
  const room = h - (style === "label" ? 92 : style === "bands" ? 96 : 70);
  const chars = book.title.length + (narrow ? by.length * 0.8 + 2 : 0);
  const base = Math.max(10.5, Math.min(15.5, w * 0.36)) * (style === "sans" ? 0.86 : 1);
  const size = Math.max(9, Math.min(base, (room * (wide ? 2 : 1)) / (chars * per)));
  const reading = book.pct > 0 && book.pct < 1;
  return (
    <div
      className={`spine ${narrow ? "is-narrow" : ""} ${wide ? "is-wide" : ""}`}
      data-style={style}
      data-light={look.light || undefined}
      style={{ width: w, height: h, background: color, color: fg, ["--fg" as string]: fg }}
    >
      {reading && <span className="spine-ribbon" aria-hidden />}
      {style === "bands" && (
        <>
          <span className="spine-bands top" />
          <span className="spine-bands bottom" />
        </>
      )}
      {style === "foil" && <span className="spine-orn">{book.favorite ? "★" : "◆"}</span>}
      {style === "sans" && <Glyph k={t.key} size={15} className="spine-emoji" />}
      <span className={`spine-title-wrap ${style === "label" ? "is-label" : ""}`}>
        <span className="spine-title" style={{ fontSize: size }}>
          {book.title}
          {narrow && <span className="spine-by">{by}</span>}
        </span>
      </span>
      {!narrow && (
        <span className="spine-author" style={{ fontSize: bySize }}>
          {by}
        </span>
      )}
    </div>
  );
});

/** The picture on a cover: the page's own picture printed in the topic's ink, else the topic's plate. */
export function Plate({ book, reveal = false }: { book: ShelfBook; reveal?: boolean }) {
  const [broken, setBroken] = useState(false);
  const cls = reveal ? "is-revealing" : "";
  if (book.image && !broken) {
    const t = TOPIC[book.topic];
    return (
      <span className="duotone" style={{ ["--ink-c" as string]: t.shades[2] }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={book.image} alt="" decoding="async" loading="lazy" draggable={false} referrerPolicy="no-referrer" className={cls} onError={() => setBroken(true)} />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={topicArtSrc(book.topic)} alt="" decoding="async" draggable={false} className={cls} />;
}

/**
 * The front of a book, for face-out display and for the book in your hands. A book from
 * Goodreads shows its own cover; anything else gets one in its topic's cloth. Sized by its
 * container, so the same cover works at any scale.
 */
export const Cover = memo(function Cover({ book, look = lookOf(book), draw = false }: { book: ShelfBook; look?: Look; draw?: boolean }) {
  const [broken, setBroken] = useState(false);
  const t = TOPIC[book.topic];
  if (book.photo && !broken) {
    return (
      <div className="cover is-photo" style={{ background: look.color }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={book.photo} alt="" decoding="async" draggable={false} className={draw ? "is-revealing" : ""} onError={() => setBroken(true)} />
        <span className="cover-hinge" aria-hidden />
      </div>
    );
  }
  return (
    <div className="cover" data-light={look.light || undefined} style={{ background: look.color, color: look.fg }}>
      <div className="cover-plate">
        <Plate book={book} reveal={draw} />
      </div>
      <div className="cover-type">
        <p className="cover-kicker">
          <Glyph k={t.key} size={14} className="cover-glyph" />
          <span>{t.name}</span>
          {book.year && <span className="tabular-nums">{book.year}</span>}
        </p>
        <p className="cover-title">{book.title}</p>
        <p className="cover-author">{book.author}</p>
      </div>
      <span className="cover-hinge" aria-hidden />
    </div>
  );
});
