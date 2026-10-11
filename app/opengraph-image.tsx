import { ImageResponse } from "next/og";
import frauncesItalic from "@/assets/fonts/Fraunces-400-italic.woff" with { type: "bytes" };
import fraunces from "@/assets/fonts/Fraunces-400-normal.woff" with { type: "bytes" };
import { hashString } from "@/lib/color";
import { getShelf } from "@/lib/data";
import { getStats } from "@/lib/shelf";
import { shelfConfig } from "@/shelf.config";

export const alt = `${shelfConfig.owner}'s Shelf`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Static Fraunces instances (the renderer can't read the variable font), imported as bytes so they're
// bundled: Next loads this module to build every page's og:image tags, and on Cloudflare Workers
// there are no project files to read at runtime.

/** Link preview: a row of the shelf's real spine colours above the title and a few stats. */
export default async function Image() {
  const shelf = await getShelf();
  const stats = getStats(shelf.items);
  const spines = shelf.items.toSorted((a, b) => hashString(a.id) - hashString(b.id)).slice(0, 34);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#f4f2ea",
          backgroundImage:
            "radial-gradient(circle at 0% 0%, rgba(255,208,138,0.55), transparent 45%), radial-gradient(circle at 100% 0%, rgba(169,216,187,0.6), transparent 45%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 250, padding: "0 30px" }}>
          {spines.map((item) => {
            const hash = hashString(item.id);
            return (
              <div
                key={item.id}
                style={{
                  width: Math.min(46, Math.max(24, 20 + (item.pages ?? 300) / 30)),
                  height: 160 + (hash % 7) * 11,
                  background: item.color,
                  borderRadius: "4px 4px 1px 1px",
                  backgroundImage:
                    "linear-gradient(90deg, rgba(0,0,0,0.28), rgba(255,255,255,0.16) 16%, rgba(255,255,255,0) 42%, rgba(0,0,0,0.3))",
                }}
              />
            );
          })}
        </div>
        <div style={{ height: 14, background: "linear-gradient(#ddd8c8, #c7c0ad)" }} />
        <div style={{ display: "flex", flexDirection: "column", padding: "44px 70px 0" }}>
          <div style={{ display: "flex", fontFamily: "Fraunces", fontSize: 104, lineHeight: 1, color: "#18201c" }}>
            <span style={{ fontStyle: "italic", color: "#1e7a58" }}>{`${shelfConfig.owner}'s`}</span>
            <span>&nbsp;Shelf</span>
          </div>
          <div style={{ marginTop: 24, fontSize: 30, color: "#66706a", fontFamily: "Fraunces" }}>
            {shelf.items.length === 0
              ? "A reading log, coming soon"
              : `${stats.booksRead.toLocaleString("en-US")} books read · ${stats.pagesTurned.toLocaleString("en-US")} pages · ${stats.onTheList} on the list`}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Fraunces", data: fraunces.slice().buffer, style: "normal", weight: 400 },
        { name: "Fraunces", data: frauncesItalic.slice().buffer, style: "italic", weight: 400 },
      ],
    },
  );
}
