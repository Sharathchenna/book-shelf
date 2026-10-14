-- Where each book and clipping stands on the home page's bookcase (lib/bookcase.ts): one of a
-- fixed set of topics and a few tags, chosen by Claude Haiku (lib/ai/shelver.ts), or by the
-- owner, which `manual` keeps from being chosen again. `favorite` is null until the owner sets it
-- (books then follow their Goodreads stars). Keyed by the book's or clipping's own id.
CREATE TABLE shelving (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  tags TEXT NOT NULL,
  favorite INTEGER,
  manual INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);
