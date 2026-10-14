/** A paper's or article's brief (lib/ai/brief.ts), as the reader shows it. Shared by the server and the reader. */

/** A sentence, and the reader's section (0-based) that shows it, when there is one. */
export type BriefPoint = { text: string; section?: number };

export type Brief = { gist: string; claims: BriefPoint[]; caveats: BriefPoint[] };

/** Briefs written by an older version of the prompt are written again when next asked for. */
export const BRIEF_VERSION = 1;

export type StoredBrief = { version: number; at: string; brief: Brief };
