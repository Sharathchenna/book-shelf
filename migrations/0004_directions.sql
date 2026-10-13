-- How Fish Audio's voices should deliver a book's sentences (lib/ai/director.ts), worked out by
-- Claude Haiku once per run of sentences and reused for listening and saving. `hash` is of the
-- sentences and the director's version: when either changes, they're directed again.
CREATE TABLE directions (
  file_id TEXT NOT NULL,
  section INTEGER NOT NULL,
  chunk INTEGER NOT NULL,
  hash TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (file_id, section, chunk)
);
