"use client";

import { useState } from "react";
import { fileName, notesMarkdown, type NotesMeta } from "@/lib/export";
import { inkSvg } from "@/lib/ink";
import type { Highlight } from "@/lib/library-types";

/** Every book's highlights and notes as Markdown files in a zip, ready for an Obsidian vault (lib/export.ts). */
export function ExportNotes() {
  const [state, setState] = useState<"idle" | "working" | "none" | "error">("idle");

  const run = async () => {
    setState("working");
    try {
      const res = await fetch("/api/export");
      if (!res.ok) throw new Error();
      const { books } = (await res.json()) as { books: { meta: NotesMeta; highlights: Highlight[] }[] };
      if (!books.length) return setState("none");
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const taken = new Set<string>();
      for (const { meta, highlights } of books) {
        // Two books with the same title get "(2)".
        let name = fileName(meta.title);
        for (let n = 2; taken.has(name); n++) name = fileName(`${meta.title} (${n})`);
        taken.add(name);
        // Drawings from the Android app go beside the notes as SVG files, embedded where they belong.
        let drawings = 0;
        const ink = (h: Highlight) => {
          const file = fileName(`${name.replace(/\.md$/, "")} ink ${++drawings}`, "svg");
          zip.file(`Highlights/attachments/${file}`, inkSvg(h.ink!, { standalone: true }));
          return `![[attachments/${file}]]`;
        };
        zip.file(`Highlights/${name}`, notesMarkdown(meta, highlights, { ink }));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Highlights ${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setState("idle");
    } catch {
      setState("error");
    }
  };

  return (
    <button type="button" onClick={run} disabled={state === "working"} className="lib-export" title="Every book's highlights and notes as Markdown, for Obsidian">
      {state === "working" ? "Exporting…" : state === "none" ? "No highlights yet" : state === "error" ? "Couldn't export. Try again" : "Export highlights"}
    </button>
  );
}
