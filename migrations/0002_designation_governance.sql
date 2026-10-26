CREATE TABLE IF NOT EXISTS management_designations (
 username TEXT PRIMARY KEY COLLATE NOCASE,
 designation TEXT NOT NULL CHECK (designation IN ('CEO','COO','OP','OVP','OM','Assistant OM','Supervisor','Team Leader','Trainer','SME')),
 assigned_by TEXT NOT NULL, assigned_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS designation_requests (
 id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE,
 requested_designation TEXT NOT NULL CHECK (requested_designation IN ('CEO','COO','OP','OVP','OM','Assistant OM','Supervisor','Team Leader','Trainer','SME')),
 status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')), requested_at TEXT NOT NULL,
 reviewed_at TEXT, reviewed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_designation_requests_status_date ON designation_requests(status,requested_at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_designation_requests_pending_user ON designation_requests(username) WHERE status='pending';
