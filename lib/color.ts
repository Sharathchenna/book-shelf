const PALETTE = [
  "#2f3a4a",
  "#7a2e2e",
  "#3f5a3c",
  "#8a6a2f",
  "#4b3b5c",
  "#2e5e63",
  "#9a4b2c",
  "#3b3b3b",
  "#6b4f3a",
  "#1f4f7a",
  "#a8a196",
  "#d9d2c3",
];

/** FNV-1a; stable across server and client. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function fallbackColor(seed: string): string {
  return PALETTE[hashString(seed) % PALETTE.length];
}

export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Readable text colour on top of `hex`. */
export function textOn(hex: string): string {
  return luminance(hex) > 0.35 ? "#1a1917" : "#f7f5f0";
}

export const COLOUR_FAMILIES = [
  { name: "Reds", swatch: "#b8332a" },
  { name: "Oranges", swatch: "#d9772b" },
  { name: "Yellows", swatch: "#d8b33a" },
  { name: "Greens", swatch: "#4f7a45" },
  { name: "Teals", swatch: "#2f7f7d" },
  { name: "Blues", swatch: "#2f5b9a" },
  { name: "Purples", swatch: "#5f4a8f" },
  { name: "Pinks", swatch: "#c2477d" },
  { name: "Neutrals", swatch: "#8c857a" },
] as const;

export type ColourFamily = (typeof COLOUR_FAMILIES)[number]["name"];

export function hsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** Which colour family a cover belongs to; blacks, whites and greys are "Neutrals". */
export function colourFamily(hex: string): ColourFamily {
  const { h, s, l } = hsl(hex);
  if (s < 0.2 || l < 0.12 || l > 0.9) return "Neutrals";
  if (h < 15 || h >= 345) return "Reds";
  if (h < 40) return "Oranges";
  if (h < 70) return "Yellows";
  if (h < 160) return "Greens";
  if (h < 195) return "Teals";
  if (h < 250) return "Blues";
  if (h < 290) return "Purples";
  return "Pinks";
}
