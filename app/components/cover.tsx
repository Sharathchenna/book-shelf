"use client";

import { useState } from "react";
import { textOn } from "@/lib/color";
import type { Item } from "@/lib/types";

/**
 * Book cover from Open Library, or a generated one when there is none (or it fails to load).
 * The cover's own colour shows while the image loads, then the image fades in.
 * `tilt` makes it lean toward the pointer (see PointerEffects).
 */
export function Cover({ item, tilt = false, className = "" }: { item: Item; tilt?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={`relative aspect-[2/3] overflow-hidden rounded-md shadow-[0_16px_30px_-14px_rgb(0_0_0/0.55)] ${tilt ? "tilt" : ""} ${className}`}
      style={{ backgroundColor: item.color }}
    >
      {item.cover && !failed ? (
        // Covers are already sized by Open Library; skipping next/image avoids re-processing hundreds of them.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.cover}
          alt=""
          loading="lazy"
          decoding="async"
          // Cached images can finish before hydration, when onLoad/onError have not been attached yet.
          ref={(img) => {
            if (!img?.complete) return;
            if (img.naturalWidth) img.dataset.loaded = "";
            else setFailed(true);
          }}
          onLoad={(e) => {
            e.currentTarget.dataset.loaded = "";
          }}
          onError={() => setFailed(true)}
          className="cover-img absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <GeneratedCover item={item} />
      )}
      {/* Paper sheen and a hint of binding on the left edge. */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(0_0_0/0.2),rgb(255_255_255/0.12)_4%,transparent_10%,transparent_70%,rgb(255_255_255/0.07))]" />
    </div>
  );
}

function GeneratedCover({ item }: { item: Item }) {
  return (
    <div
      className="absolute inset-0 flex flex-col justify-between bg-[linear-gradient(160deg,rgb(255_255_255/0.16),transparent_55%,rgb(0_0_0/0.28))] p-[9%] pt-[20%]"
      style={{ color: textOn(item.color) }}
    >
      <p className="font-serif text-[clamp(1rem,1.6vw,1.6rem)] leading-[1.05] [overflow-wrap:anywhere]">{item.title}</p>
      <p className="border-t border-current/30 pt-2 text-[0.6rem] font-semibold tracking-[0.14em] uppercase opacity-80">
        {item.author}
      </p>
    </div>
  );
}
