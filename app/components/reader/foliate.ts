/**
 * A typed layer over foliate-js (https://github.com/johnfactotum/foliate-js), which renders the
 * EPUB in sandbox-less iframes. Browser-only: load it with `loadFoliate()` from an effect.
 */

export type TocItem = { label: string; href: string; subitems?: TocItem[] };

export type Location = {
  /** Through the whole book, 0–1. */
  fraction: number;
  section?: { current: number; total: number };
  /** Minutes left, estimated from text length. */
  time?: { section: number; total: number };
  tocItem?: { label: string; href: string };
  cfi: string;
  range: Range;
};

export type Annotation = { value: string; color?: string };

export type FoliateView = HTMLElement & {
  book: {
    toc?: TocItem[];
    sections: { linear?: string }[];
    dir?: string;
    transformTarget?: EventTarget;
    metadata?: { title?: unknown };
  };
  renderer: HTMLElement & {
    setStyles?: (css: string) => void;
    getContents: () => { doc: Document; index: number }[];
  };
  lastLocation?: Location;
  open: (file: Blob | File) => Promise<void>;
  init: (opts: { lastLocation?: string | null; showTextStart?: boolean }) => Promise<void>;
  close: () => void;
  goTo: (target: string | number) => Promise<void>;
  goToFraction: (fraction: number) => Promise<void>;
  goLeft: () => Promise<void>;
  goRight: () => Promise<void>;
  prev: () => Promise<void>;
  next: () => Promise<void>;
  getCFI: (index: number, range: Range) => string;
  getSectionFractions: () => number[];
  addAnnotation: (annotation: Annotation, remove?: boolean) => Promise<void>;
  deleteAnnotation: (annotation: Annotation) => Promise<void>;
  search: (opts: { query: string }) => AsyncGenerator<
    "done" | { progress?: number; label?: string; subitems?: { cfi: string; excerpt: { pre: string; match: string; post: string } }[] }
  >;
  clearSearch: () => void;
  deselect: () => void;
};

export async function loadFoliate(): Promise<{ create: () => FoliateView; highlight: unknown }> {
  await import("foliate-js/view.js");
  await import("foliate-js/paginator.js");
  guardPaginatorRender();
  const { Overlayer } = await import("foliate-js/overlayer.js");
  return { create: () => document.createElement("foliate-view") as FoliateView, highlight: Overlayer.highlight };
}

/**
 * foliate's paginator can lay out a chapter while its document is still loading (the root
 * element exists, <body> not yet), which throws inside the library. Skip that pass: the
 * paginator lays out again once the chapter has loaded. Any other error still surfaces.
 */
function guardPaginatorRender() {
  const Paginator = customElements.get("foliate-paginator") as
    | (CustomElementConstructor & { prototype: { render: (...args: unknown[]) => unknown; __guarded?: true; getContents: () => { doc?: Document }[] } })
    | undefined;
  if (!Paginator || Paginator.prototype.__guarded) return;
  const render = Paginator.prototype.render;
  Paginator.prototype.render = function (this: typeof Paginator.prototype, ...args: unknown[]) {
    try {
      return render.apply(this, args);
    } catch (error) {
      const loading = this.getContents().some(({ doc }) => doc && !doc.body);
      if (!(error instanceof TypeError) || !loading) throw error;
    }
  };
  Paginator.prototype.__guarded = true;
}

/**
 * EPUBs can carry JavaScript, and foliate's iframes must allow scripts (a WebKit limitation),
 * so every document is cleaned before it renders: no <script>, no inline event handlers,
 * no javascript: URLs, no nested frames. The /reader CSP blocks any script from elsewhere.
 */
export function sanitizeBook(transformTarget: EventTarget | undefined) {
  transformTarget?.addEventListener("data", (event) => {
    const detail = (event as CustomEvent<{ data: unknown; type: string }>).detail;
    const type = detail.type;
    if (!/(x?html|svg)/.test(type)) return;
    detail.data = Promise.resolve(detail.data).then((data) => (typeof data === "string" ? sanitize(data, type) : data));
  });
}

function sanitize(source: string, type: string): string {
  const mime = type.includes("svg") ? "image/svg+xml" : type.includes("xhtml") ? "application/xhtml+xml" : "text/html";
  const doc = new DOMParser().parseFromString(source, mime as DOMParserSupportedType);
  if (doc.querySelector("parsererror")) {
    // Not well-formed: fall back to stripping the dangerous parts textually.
    return source
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/javascript:/gi, "");
  }
  doc.querySelectorAll("script, iframe, object, embed, frame, frameset, form").forEach((el) => el.remove());
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || ((name.endsWith("href") || name === "src" || name === "action") && value.startsWith("javascript:"))) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return mime === "text/html" ? doc.documentElement.outerHTML : new XMLSerializer().serializeToString(doc);
}

export type ThemeName = "paper" | "sepia" | "sage" | "night";

export const THEMES: Record<ThemeName, { label: string; bg: string; fg: string; muted: string; link: string }> = {
  paper: { label: "Paper", bg: "#f7f4ec", fg: "#22201b", muted: "#7a756a", link: "#1e7a58" },
  sepia: { label: "Sepia", bg: "#f1e6cf", fg: "#4a3b2a", muted: "#8a7558", link: "#8a5a1e" },
  sage: { label: "Sage", bg: "#e6eee7", fg: "#1d2a23", muted: "#5f7065", link: "#1e7a58" },
  night: { label: "Night", bg: "#121614", fg: "#d8ddd7", muted: "#7d877f", link: "#6fd3a8" },
};

export const FONTS = {
  original: { label: "Original", stack: "" },
  serif: { label: "Serif", stack: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif' },
  charter: { label: "Charter", stack: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif' },
  sans: { label: "Sans", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
} as const;

export type FontName = keyof typeof FONTS;

export type ReaderSettings = {
  theme: ThemeName;
  font: FontName;
  /** Percent of the book's base size. */
  size: number;
  lineHeight: number;
  /** Column width in px (max-inline-size). */
  width: number;
  justify: boolean;
  flow: "paginated" | "scrolled";
  spread: boolean;
};

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "paper",
  font: "serif",
  size: 105,
  lineHeight: 1.6,
  width: 680,
  justify: true,
  flow: "paginated",
  spread: true,
};

/** CSS injected into each book document (as foliate's demo reader does). */
export function bookCss(s: ReaderSettings): string {
  const t = THEMES[s.theme];
  const font = FONTS[s.font].stack;
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    /* Transparent: the reader's own backdrop shows the theme colour. foliate copies the page
       background onto its container once per chapter, so a solid colour here would go stale. */
    html { color-scheme: ${s.theme === "night" ? "dark" : "light"}; color: ${t.fg} !important; background: transparent !important; font-size: ${s.size}% !important; }
    body { color: inherit !important; background: transparent !important; }
    ${font ? `body, p, li, blockquote, dd, div, span { font-family: ${font} !important; }` : ""}
    p, li, blockquote, dd {
      line-height: ${s.lineHeight} !important;
      text-align: ${s.justify ? "justify" : "start"};
      hyphens: ${s.justify ? "auto" : "manual"};
      -webkit-hyphens: ${s.justify ? "auto" : "manual"};
      hanging-punctuation: allow-end last;
      widows: 2; orphans: 2;
    }
    [align="left"] { text-align: left; } [align="right"] { text-align: right; } [align="center"] { text-align: center; }
    a:link, a:visited { color: ${t.link} !important; }
    img, svg { max-width: 100%; height: auto; }
    ${s.theme === "night" ? "img { filter: brightness(.85) contrast(1.05); }" : ""}
    ::selection { background: ${s.theme === "night" ? "rgba(111,211,168,.35)" : "rgba(30,122,88,.22)"}; }
    pre { white-space: pre-wrap !important; }
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
  `;
}

export const HIGHLIGHT_HEX = {
  yellow: "#f5d76e",
  green: "#9ad8b1",
  blue: "#9cc4f2",
  pink: "#f3a6c8",
} as const;
