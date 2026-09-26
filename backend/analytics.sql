-- Additive and idempotent. Uses the existing DB binding.
CREATE TABLE IF NOT EXISTS analytics_daily (
  day TEXT PRIMARY KEY,
  visits INTEGER NOT NULL DEFAULT 0 CHECK (visits >= 0)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS analytics_uniques (
  day TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  PRIMARY KEY (day, visitor_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS analytics_presence (
  visitor_id TEXT PRIMARY KEY,
  last_visit INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS analytics_presence_seen ON analytics_presence(last_seen);
