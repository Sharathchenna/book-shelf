-- The daily review on the library page (lib/review.ts): where each highlight stands in it. A
-- highlight kept in rotation comes back after `due` (epoch ms), a little later each time (`step`);
-- one marked done (`off`) never comes back. Kept apart from the highlights themselves (`notes`),
-- which the reader replaces whole after every change.
CREATE TABLE reviews (
  highlight_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  due INTEGER NOT NULL,
  last INTEGER NOT NULL,
  off INTEGER NOT NULL DEFAULT 0
);
