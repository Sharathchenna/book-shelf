/**
 * The daily review: a few of your own highlights each day, spaced out the way flashcards are
 * (from Gloss). A highlight kept in rotation comes back after 3 days, then a week, two weeks, a
 * month and so on; one marked done never comes back. Days are the reader's own: the browser
 * says when its day began.
 */

export const DAILY = 5;
const DAY = 86_400_000;
const STEPS = [3, 7, 16, 35, 75, 160];

/** Where a highlight stands in the review; absent until it's first seen. */
export type Review = { step: number; due: number; last: number; off?: boolean };

/** A highlight as the review needs it. `createdAt` is ISO, as the reader stores it. */
export type Reviewable = { id: string; text: string; createdAt: string; review?: Review };

/** A line with some substance reads better than a single marked word. */
const weight = (h: Reviewable) => (h.text.trim().split(/\s+/).length >= 6 ? 0 : 1);

/** Today's highlights still to see, and how many were already seen today. `today` is when the reader's day began. */
export function todaysReview<T extends Reviewable>(all: T[], today: number): { deck: T[]; done: number } {
  const tomorrow = today + DAY;
  const done = all.filter((h) => (h.review?.last ?? 0) >= today).length;
  const due = all
    .filter((h) => !h.review?.off && Date.parse(h.createdAt) < today && (h.review?.last ?? 0) < today && (h.review?.due ?? 0) < tomorrow)
    .sort((a, b) => weight(a) - weight(b) || (a.review?.due ?? Date.parse(a.createdAt)) - (b.review?.due ?? Date.parse(b.createdAt)));
  return { deck: due.slice(0, Math.max(0, DAILY - done)), done };
}

/** Seen and kept: it comes back later, each time a little later than the last. */
export function keepInRotation(prev: Review | undefined, today: number, now = Date.now()): Review {
  const step = (prev?.step ?? -1) + 1;
  return { step, last: now, due: today + STEPS[Math.min(step, STEPS.length - 1)] * DAY };
}

/** Seen and done with: it stays a highlight, but leaves the review. */
export function retire(prev: Review | undefined, now = Date.now()): Review {
  return { step: prev?.step ?? 0, due: prev?.due ?? now, last: now, off: true };
}
