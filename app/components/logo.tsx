/** Three books on a shelf, the last leaning on the tallest, on an emerald tile. app/icon.svg is the same mark for the favicon. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`block shrink-0 overflow-hidden rounded-[28%] bg-[linear-gradient(rgb(255_255_255/0.16),transparent_50%),linear-gradient(140deg,#3fae84,#1e7a58_50%,#14435a)] shadow-[inset_0_1px_0_rgb(255_255_255/0.3)] ${className}`}
    >
      <svg viewBox="0 0 64 64" className="size-full">
        <g transform="translate(32 33.5) scale(1.15) translate(-32 -29)">
          <rect x="15" y="20" width="8.5" height="26" rx="1.6" fill="#f7f0df" />
          <rect x="15" y="24" width="8.5" height="1.8" fill="#1e7a58" opacity="0.4" />
          <rect x="15" y="40" width="8.5" height="1.8" fill="#1e7a58" opacity="0.4" />
          <rect x="25.5" y="14" width="9.5" height="32" rx="1.6" fill="#ffc463" />
          <rect x="25.5" y="19" width="9.5" height="1.8" fill="#8a5a12" opacity="0.4" />
          <rect x="25.5" y="39" width="9.5" height="1.8" fill="#8a5a12" opacity="0.4" />
          <path d="M30 16V8.5l1.4 1.3 1.4-1.3V16z" fill="#f7f0df" />
          <g transform="rotate(-14 41.2 46)">
            <rect x="41.2" y="21" width="8" height="25" rx="1.6" fill="#ff8b70" />
            <rect x="41.2" y="25" width="8" height="1.8" fill="#7a2a1a" opacity="0.4" />
          </g>
          <rect x="13" y="46" width="38" height="3.6" rx="1.8" fill="#f7f0df" />
        </g>
      </svg>
    </span>
  );
}
