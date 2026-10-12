-- Chapters of books read aloud by the narrator, one row per voice and section. The MP3 is in
-- storage (keys.audio); `data` holds each sentence's place in the text and in the audio.
CREATE TABLE audio (
  file_id TEXT NOT NULL,
  voice TEXT NOT NULL,
  section INTEGER NOT NULL,
  duration REAL NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (file_id, voice, section)
);
