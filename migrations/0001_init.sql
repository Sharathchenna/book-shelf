-- Each row keeps its record whole as JSON in `data` (the types in lib/types.ts and
-- lib/library-types.ts); the other columns are what queries sort and look up by.

-- Books on the shelf, synced from Goodreads.
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  -- Order in the Goodreads feeds (most recently shelved first).
  position INTEGER NOT NULL,
  -- 1 once Open Library has been asked about it, found or not, so it isn't asked again.
  looked_up INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);

-- Articles, papers, newsletter issues and tweets.
CREATE TABLE clippings (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  saved TEXT NOT NULL,
  added_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX clippings_by_kind ON clippings (kind, saved DESC);

-- EPUBs and PDFs in the reader (the bytes are in R2), with the owner's place and notes in each.
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  added_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE progress (
  file_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE notes (
  file_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

-- Small settings and stamps, such as when the shelf last changed.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
