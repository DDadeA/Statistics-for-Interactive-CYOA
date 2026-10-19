-- Counters backing /api/count, maintained on every log insert (see insertLog in src/lib/server/logs.ts)
CREATE TABLE IF NOT EXISTS stats (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

-- Membership tables so "is this uid / data_hash new?" is a single index lookup
CREATE TABLE IF NOT EXISTS seen_uids (uid TEXT PRIMARY KEY) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS seen_hashes (data_hash TEXT PRIMARY KEY) WITHOUT ROWID;

-- Backfill from existing logs (safe to re-run)
INSERT OR IGNORE INTO seen_uids SELECT DISTINCT uid FROM logs;
INSERT OR IGNORE INTO seen_hashes SELECT DISTINCT data_hash FROM logs WHERE data_hash IS NOT NULL;

INSERT OR REPLACE INTO stats (key, value) VALUES
  ('total_time_ms', (SELECT COALESCE(SUM(time_on_page), 0) FROM logs)),
  ('uid_count', (SELECT COUNT(*) FROM seen_uids)),
  ('build_count', (SELECT COUNT(*) FROM seen_hashes));
