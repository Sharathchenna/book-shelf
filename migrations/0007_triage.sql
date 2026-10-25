-- Where each book and clipping stands in the owner's reading, as Readwise Reader keeps it
-- (lib/triage.ts): in the Inbox (new), saved for Later, or in the Archive (done with); whether
-- it's been opened yet (`seen`), and, when it's been put in the Trash, since when. Keyed by the
-- book's or clipping's own id; a thing with no row stands where lib/triage.ts says by default.
CREATE TABLE triage (
  id TEXT PRIMARY KEY,
  place TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  trashed_at TEXT,
  at TEXT NOT NULL
);
