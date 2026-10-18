import type { Ink } from "./library-types";

/**
 * A stylus drawing from the Android app as SVG: for the web reader, which shows drawings but
 * can't make them, and for the Markdown export, where each drawing is a file Obsidian embeds.
 * Each stroke is a run of short segments, each as wide as the pen was pressed there. The drawing's
 * colours and numbers were checked when it was saved (app/api/books/[id]/notes).
 */
export function inkSvg(ink: Ink, { standalone = false } = {}): string {
  const [w, h] = ink.size;
  const lines: string[] = [];
  for (const stroke of ink.strokes) {
    const p = stroke.points;
    if (p.length === 3) {
      lines.push(`<circle cx="${p[0]}" cy="${p[1]}" r="${round((stroke.width * (p[2] || 0.5)) / 2)}" fill="${stroke.color}"/>`);
      continue;
    }
    for (let i = 3; i < p.length; i += 3) {
      const width = round(stroke.width * Math.max(0.15, (p[i - 1] + p[i + 2]) / 2 || 0.5));
      lines.push(`<line x1="${p[i - 3]}" y1="${p[i - 2]}" x2="${p[i]}" y2="${p[i + 1]}" stroke="${stroke.color}" stroke-width="${width}"/>`);
    }
  }
  const ns = standalone ? ` xmlns="http://www.w3.org/2000/svg" width="${round(w * (ink.place === "page" ? 800 : 1))}" height="${round(h * (ink.place === "page" ? 800 : 1))}"` : "";
  return `<svg${ns} viewBox="0 0 ${w} ${h}" stroke-linecap="round" fill="none">${lines.join("")}</svg>`;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
