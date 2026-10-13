/**
 * Directions for Fish Audio's voices: how to deliver a sentence, worked out by Claude Haiku
 * (lib/ai/director.ts) and applied here, where the reader builds what it sends to Fish. Fish's
 * S2 model takes words in square brackets as directions: a delivery cue at the start
 * ("[dry] Mr. Bennet replied…"), `[emphasis]` before a word to stress, `[break]` for a pause.
 * The words themselves are never changed, so what's highlighted is still exactly what's said.
 */

/** One sentence's direction. Each part is optional; phrases are exact text from the sentence. */
export type Direction = { cue?: string; emphasis?: string; pauseBefore?: string };

/** Sentences directed in one go: small enough that the first are ready a second or two after asking. */
export const DIRECTION_CHUNK = 40;

/** Bumped when the director's instructions change, so chapters are directed again. */
export const DIRECTOR_VERSION = 1;

/** Fish's sound effects: a narrator reading a book shouldn't laugh, sob or yawn on its own account. */
const SOUNDS = /\b(laugh|chuckl|sob|cry|crying|sigh|groan|pant|gasp|yawn|snor|throat|audience|background|crowd|scream)/i;

/** A delivery cue: a few plain lowercase words ("dry", "warm, amused"), and not a sound effect. */
export function validCue(cue: string): boolean {
  return /^[a-z][a-z ,'-]{0,39}$/.test(cue) && cue.split(/\s+/).length <= 5 && !SOUNDS.test(cue);
}

/** A phrase from the sentence: a few words that are really there. */
function phraseAt(say: string, phrase: string | undefined, from = 0): number {
  if (!phrase || phrase.split(/\s+/).length > 4 || /[[\]]/.test(phrase)) return -1;
  return say.indexOf(phrase, from);
}

/** A sentence as sent to Fish, with its direction inserted (anything that doesn't fit is left out). */
export function directed(say: string, direction: Direction | null | undefined): string {
  if (!direction) return say;
  const marks: { at: number; tag: string }[] = [];
  const pause = phraseAt(say, direction.pauseBefore, 1);
  if (pause > 0) marks.push({ at: pause, tag: "[break] " });
  const stress = phraseAt(say, direction.emphasis);
  if (stress >= 0) marks.push({ at: stress, tag: "[emphasis] " });
  let out = say;
  // From the end, so earlier positions stay put; a pause goes before emphasis at the same place.
  for (const { at, tag } of marks.sort((a, b) => b.at - a.at || (a.tag === "[break] " ? 1 : -1))) {
    out = out.slice(0, at) + tag + out.slice(at);
  }
  return direction.cue && validCue(direction.cue) ? `[${direction.cue}] ${out}` : out;
}

/** A book's own square brackets, as parentheses, so Fish doesn't take them as directions. */
export const plainBrackets = (text: string) => text.replace(/\[/g, "(").replace(/\]/g, ")");
