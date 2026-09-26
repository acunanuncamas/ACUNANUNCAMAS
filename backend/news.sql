-- Additive, repeatable migration. Legacy news and all other tables remain intact.
CREATE TABLE IF NOT EXISTS news_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  date TEXT,
  external_url TEXT NOT NULL,
  r2_key TEXT,
  visual_type TEXT NOT NULL DEFAULT 'mediana' CHECK (visual_type IN ('principal', 'mediana', 'pequena', 'tipografica')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS news_entries_public_order ON news_entries(published, sort_order, created_at DESC, id DESC);
