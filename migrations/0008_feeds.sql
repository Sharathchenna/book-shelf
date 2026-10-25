-- The owner's feeds (RSS and Atom), as Readwise Reader's Feed has them (lib/feeds.ts): each site
-- subscribed to, checked every hour, and what it has published. An item is seen once looked at;
-- opened or saved, it becomes a clipping (`clip_id`), read and highlighted like any other.
CREATE TABLE feeds (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL,
  added_at TEXT NOT NULL,
  checked_at TEXT
);

CREATE TABLE feed_items (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL,
  published TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  clip_id TEXT,
  data TEXT NOT NULL,
  added_at TEXT NOT NULL
);
CREATE INDEX feed_items_by_date ON feed_items (published DESC);
CREATE INDEX feed_items_by_feed ON feed_items (feed_id, published DESC);
