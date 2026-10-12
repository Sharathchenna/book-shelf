/**
 * What the narrator reads in a section: its text, block by block, with the way back from a
 * position in that text to the page (to highlight the sentence being read). Built the same way
 * from the same document on every device, so positions saved with a chapter's audio still point
 * at the right words when it plays somewhere else.
 */

export type SpeechBlock = { start: number; end: number; heading: boolean };

export type SpeechText = {
  /** The blocks' text, separated by newlines. Apart from those and spaces between maths tokens, each character is one on the page. */
  text: string;
  blocks: SpeechBlock[];
  /** Each text node read, and where it starts in `text`. */
  nodes: { node: Text; at: number }[];
};

const BLOCKS = new Set([
  "address", "article", "aside", "blockquote", "body", "caption", "dd", "details", "div", "dl", "dt",
  "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr",
  "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "td", "th", "tr", "ul",
]);
const HEADINGS = /^h[1-6]$/;
/** Never read aloud: code, media, controls, ruby glosses, and MathML's LaTeX source. */
const SKIP = new Set([
  "script", "style", "noscript", "template", "head", "svg", "img", "picture", "video", "audio", "iframe",
  "object", "embed", "canvas", "rt", "rp", "button", "input", "select", "textarea", "nav", "annotation",
  "annotation-xml", "pre", "code",
]);
const NOTE_MARK = /^[\d\s*†‡§¶,–-]+$/;
/** Class names books give illustrations and their captions (Project Gutenberg's figcenter and caption, among others). */
const ILLUSTRATION = /(^|\s)(fig\w*|\w*caption\w*|illus\w*|image\w*|img\w*)(\s|$)/i;

function skipped(el: Element, paper: boolean): boolean {
  const name = el.localName;
  if (SKIP.has(name) || el.hasAttribute("hidden")) return true;
  if (/display\s*:\s*none/i.test(el.getAttribute("style") ?? "")) return true;
  const type = el.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? el.getAttribute("epub:type") ?? "";
  // Footnotes (hidden on the page too) and their marks.
  if (/\b(foot|end|rear)?note(ref)?\b/.test(type) || el.matches("a.noteref, a[data-footnote], p.footnote")) return true;
  if (name === "sup" && NOTE_MARK.test(el.textContent ?? "")) return true;
  // Display equations have nothing a voice can say well; inline maths is read token by token.
  if (name === "math" && el.getAttribute("display") === "block") return true;
  if (paper) {
    // Papers: citations, the bibliography, data tables and equation numbers are for the eye.
    if (name === "cite") return true;
    if (el.matches(".ltx_bibliography, .ltx_tabular, .ltx_eqn_eqno, .ltx_listing, .ltx_note_outer")) return true;
    // Multi-line equations are tables of inline maths: as hard to hear as a display equation.
    if (el.matches("table.ltx_equation, table.ltx_equationgroup, table.ltx_eqn_table")) return true;
  } else if (name === "figure" || name === "figcaption" || ILLUSTRATION.test(el.getAttribute("class") ?? "")) {
    // Books: an illustration's caption would break into the story (a paper's figures are read).
    return true;
  }
  return false;
}

/** Reads a section document's speakable text. `paper` turns on the extra skipping papers need. */
export function speechText(doc: Document, paper: boolean): SpeechText {
  let text = "";
  const nodes: SpeechText["nodes"] = [];
  const blocks: SpeechBlock[] = [];
  let blockStart = -1;
  let heading = false;

  const endBlock = () => {
    if (blockStart < 0) return;
    // A block with no words (a rule, a lone image's spacing) isn't read.
    if (/[\p{L}\p{N}]/u.test(text.slice(blockStart))) blocks.push({ start: blockStart, end: text.length, heading });
    blockStart = -1;
    heading = false;
  };
  const startBlock = () => {
    if (blockStart >= 0) return;
    if (text) text += "\n";
    blockStart = text.length;
  };

  /** Words said aloud that aren't on the page ("over" for a fraction): in the text, but mapped to no node. */
  const say = (words: string) => {
    if (blockStart >= 0) text += ` ${words} `;
  };

  const visit = (node: Node, inMath: boolean, inHeading: boolean) => {
    if (node.nodeType === 3) {
      const raw = node.textContent ?? "";
      if (!raw || (blockStart < 0 && !raw.trim())) return;
      startBlock();
      heading ||= inHeading;
      // Maths tokens (mi, mn, mo) sit side by side with no spaces between them.
      if (inMath && text.length > blockStart && !text.endsWith(" ")) text += " ";
      nodes.push({ node: node as Text, at: text.length });
      text += raw.replace(/\s/g, " ");
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (skipped(el, paper)) return;
    const name = el.localName;
    if (name === "br") {
      if (blockStart >= 0) text += " ";
      return;
    }
    const block = BLOCKS.has(name);
    if (block) endBlock();
    const [first, second] = el.children;
    if (inMath && name === "mfrac" && first && second) {
      visit(first, true, inHeading);
      say("over");
      visit(second, true, inHeading);
    } else {
      if (inMath && name === "msqrt") say("the square root of");
      walk(el, inMath || name === "math", inHeading || HEADINGS.test(name));
    }
    if (block) endBlock();
  };
  const walk = (el: Element, inMath: boolean, inHeading: boolean) => {
    for (let child = el.firstChild; child; child = child.nextSibling) visit(child, inMath, inHeading);
  };
  if (doc.body) walk(doc.body, false, false);
  endBlock();
  return { text, blocks, nodes };
}

/** The DOM point at `offset` in `speech.text`. Between text nodes, the start of the next (or end of the last). */
function point(speech: SpeechText, offset: number, edge: "start" | "end"): [Text, number] | null {
  const { nodes } = speech;
  if (!nodes.length) return null;
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (nodes[mid].at <= offset) lo = mid;
    else hi = mid - 1;
  }
  const { node, at } = nodes[lo];
  const len = node.length;
  if (offset - at <= len) return [node, Math.max(0, offset - at)];
  // In a gap after this node: a start moves to the next node, an end stays here.
  if (edge === "end" || lo === nodes.length - 1) return [node, len];
  return [nodes[lo + 1].node, 0];
}

/** A range over `speech.text[start, end)` in the document it was read from. */
export function rangeFor(speech: SpeechText, start: number, end: number): Range | null {
  const a = point(speech, start, "start");
  const b = point(speech, end, "end");
  if (!a || !b) return null;
  const range = a[0].ownerDocument.createRange();
  range.setStart(a[0], a[1]);
  range.setEnd(b[0], b[1]);
  return range;
}

/** Where a DOM point falls in `speech.text`: the first text read at or after it. */
export function offsetAt(speech: SpeechText, node: Node, offset: number): number {
  const doc = node.ownerDocument ?? (node as Document);
  const here = doc.createRange();
  here.setStart(node, offset);
  for (const entry of speech.nodes) {
    if (entry.node === node) return entry.at + offset;
    if (here.comparePoint(entry.node, 0) >= 0) return entry.at;
  }
  return speech.text.length;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Finds a sentence saved with a chapter's audio in this document's text: at its saved offsets
 * when the text there still matches, otherwise by searching on from `from`.
 */
export function locate(speech: SpeechText, line: { start: number; end: number; text: string }, from = 0): [number, number] | null {
  const want = squash(line.text);
  if (squash(speech.text.slice(line.start, line.end)) === want) return [line.start, line.end];
  const at = speech.text.indexOf(line.text, from);
  if (at >= 0) return [at, at + line.text.length];
  const loose = speech.text.indexOf(line.text, 0);
  return loose >= 0 ? [loose, loose + line.text.length] : null;
}

const SYMBOLS: Record<string, string> = {
  "=": " equals ", "≈": " is approximately ", "≠": " is not equal to ", "≤": " is at most ", "≥": " is at least ",
  "<": " is less than ", ">": " is greater than ", "+": " plus ", "−": " minus ", "×": " times ", "·": " times ",
  "∈": " in ", "∑": " the sum of ", "∏": " the product of ", "√": " the square root of ", "∞": " infinity ",
  "→": " to ", "∼": " distributed as ", "∂": " partial ", "∇": " gradient of ",
};
const GREEK: Record<string, string> = {
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", ϵ: "epsilon", ζ: "zeta", η: "eta", θ: "theta",
  κ: "kappa", λ: "lambda", μ: "mu", ν: "nu", ξ: "xi", π: "pi", ρ: "rho", σ: "sigma", τ: "tau", φ: "phi",
  ϕ: "phi", χ: "chi", ψ: "psi", ω: "omega", Σ: "sigma", Δ: "delta", Θ: "theta", Λ: "lambda", Φ: "phi", Ω: "omega",
};

/** The words to say for a sentence: whitespace tidied, citation marks dropped, symbols spelled out. */
export function spoken(text: string, paper: boolean): string {
  // Maths letters (𝐳, ℝ) as plain ones; no invisible operators or zero-width spaces.
  let s = squash((paper ? text.normalize("NFKC") : text).replace(/[\u200b-\u200d\u2060-\u2064\ufeff]/g, ""))
    .replace(/\s*\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, "")
    .replace(/[*†‡]/g, "")
    .replace(/\be\.g\.,?/gi, "for example,")
    .replace(/\bi\.e\.,?/gi, "that is,");
  if (paper) {
    s = s
      .replace(/\bet al\./g, "et al")
      .replace(/\bFigs?\.\s*/g, "Figure ")
      .replace(/\bEqs?\.\s*/g, "Equation ")
      .replace(/\bSecs?\.\s*/g, "Section ")
      .replace(/\bTab\.\s*/g, "Table ")
      .replace(/[=≈≠≤≥<>+−×·∈∑∏√∞→∼∂∇]/g, (c) => SYMBOLS[c] ?? c)
      .replace(/[αβγδεϵζηθκλμνξπρσςτφϕχψωΣΔΘΛΦΩ]/g, (c) => ` ${GREEK[c] ?? c} `);
  }
  // Tidy what dropped citations and spaced-out maths leave behind: "structure ." and "( x".
  return squash(s).replace(/\s+([.,;:!?)\]])/g, "$1").replace(/([(\[])\s+/g, "$1");
}

/** Whether a sentence has anything to say once tidied. */
export const sayable = (text: string) => /[\p{L}\p{N}]/u.test(text);
