/** The few line icons the bookcase uses (drawn as Lucide draws them), at any size. */

type IconProps = { size?: number; className?: string; fill?: string; strokeWidth?: number };

function icon(paths: React.ReactNode) {
  return function Icon({ size = 16, className, fill = "none", strokeWidth = 2 }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden
      >
        {paths}
      </svg>
    );
  };
}

export const ArrowRight = icon(<path d="M5 12h14M12 5l7 7-7 7" />);
export const ArrowUpRight = icon(<path d="M7 7h10v10M7 17 17 7" />);
export const ChevronDown = icon(<path d="m6 9 6 6 6-6" />);
export const ChevronLeft = icon(<path d="m15 18-6-6 6-6" />);
export const ChevronRight = icon(<path d="m9 18 6-6-6-6" />);
export const X = icon(<path d="M18 6 6 18M6 6l12 12" />);
export const Search = icon(
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>,
);
export const Star = icon(
  <path d="M11.5 2.3a.5.5 0 0 1 1 0l2.3 4.7a2.1 2.1 0 0 0 1.6 1.2l5.2.8a.5.5 0 0 1 .3.9l-3.8 3.7a2.1 2.1 0 0 0-.6 1.9l.9 5.2a.5.5 0 0 1-.8.6l-4.6-2.5a2.1 2.1 0 0 0-2 0L5 21.2a.5.5 0 0 1-.8-.6l.9-5.2a2.1 2.1 0 0 0-.6-1.9L.7 9.9a.5.5 0 0 1 .3-.9l5.2-.8a2.1 2.1 0 0 0 1.6-1.2z" />,
);
export const Trash2 = icon(<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />);
export const LayoutGrid = icon(
  <>
    <rect width="7" height="7" x="3" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="14" rx="1" />
    <rect width="7" height="7" x="3" y="14" rx="1" />
  </>,
);
export const LibraryIcon = icon(<path d="m16 6 4 14M12 6v14M8 8v12M4 4v16" />);
