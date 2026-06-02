-- otpviego D1 schema
-- Çalıştır:  wrangler d1 execute otpviego-comments --file=schema.sql --remote

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  edit_token TEXT,
  likes      INTEGER NOT NULL DEFAULT 0,
  dislikes   INTEGER NOT NULL DEFAULT 0,
  ip_hash    TEXT
);

CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at DESC);
CREATE INDEX IF NOT EXISTS comments_ip_idx ON comments(ip_hash);

-- IP başına 1 oy: composite PK (ip_hash, comment_id)
CREATE TABLE IF NOT EXISTS reactions (
  ip_hash    TEXT    NOT NULL,
  comment_id INTEGER NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('like','dislike')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, comment_id)
);
CREATE INDEX IF NOT EXISTS reactions_comment_idx ON reactions(comment_id);
