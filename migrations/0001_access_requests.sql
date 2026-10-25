PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_requests_status_requested
  ON access_requests(status, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_pending_email
  ON access_requests(email) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_pending_username
  ON access_requests(username) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS request_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
  ON audit_events(created_at DESC);
