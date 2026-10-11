-- Which books and clippings are in the search index, and a hash of the text that was embedded:
-- a document is embedded again only when its text changes.
CREATE TABLE embeddings (
  doc_id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
