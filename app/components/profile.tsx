import { getStats } from "@/lib/shelf";
import type { Item } from "@/lib/types";
import type { ShelfConfig } from "@/shelf.config";
import { SyncButton } from "./sync-button";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export function Profile({ config, updatedAt }: { config: ShelfConfig; updatedAt: string }) {
  return (
    <div id="about" className="flex scroll-mt-28 flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-center gap-5">
        {config.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={config.avatar} alt="" className="size-20 rounded-full object-cover shadow-lg ring-4 ring-bg" />
        ) : (
          <span className="grid size-20 shrink-0 place-items-center rounded-full bg-[linear-gradient(140deg,#3aa57c,#1e7a58_50%,#174a5c)] font-serif text-4xl text-white italic shadow-lg ring-4 ring-bg">
            {config.owner[0]}
          </span>
        )}
        <div>
          <h2 className="font-serif text-5xl leading-none sm:text-6xl">{config.owner}&apos;s Shelf</h2>
          <p className="mt-2 max-w-xl text-muted">{config.bio}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted/80">
            Updated {dateFormat.format(new Date(updatedAt))}
            <SyncButton />
          </p>
        </div>
      </div>
      {config.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {config.links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="pill">
              {link.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function Stats({ items }: { items: Item[] }) {
  const stats = getStats(items);
  const cards: [React.ReactNode, string][] = [
    [stats.booksRead.toLocaleString("en-US"), "Books read"],
    [stats.pagesTurned.toLocaleString("en-US"), "Pages turned"],
    [
      <>
        {stats.averageRating.toFixed(2)}
        <span className="ml-1 align-[0.35em] font-sans text-base text-star">★</span>
      </>,
      "Average rating",
    ],
    [stats.readingNow, "Reading now"],
    [stats.onTheList, "On the list"],
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {cards.map(([value, label]) => (
        <div
          key={label}
          className="glass flex flex-col-reverse rounded-2xl px-5 py-4 transition-transform duration-300 last:col-span-2 hover:-translate-y-0.5 sm:last:col-span-1"
        >
          <dt className="mt-1 text-[11px] font-medium tracking-[0.14em] text-muted uppercase">{label}</dt>
          <dd className="font-serif text-4xl">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
