PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 120000,
  team TEXT NOT NULL DEFAULT 'Unassigned',
  extension TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available','On Phone','On Wrap','Unavailable','Logged Out')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_employees_team_status ON employees(team, status);
CREATE TABLE IF NOT EXISTS employee_skills (
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  skill TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (employee_id, skill)
);
CREATE TABLE IF NOT EXISTS call_activity (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  call_type TEXT NOT NULL CHECK (call_type IN ('Inbound','Outbound')),
  phone_number TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  disposition TEXT NOT NULL DEFAULT 'In progress',
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_call_activity_employee_started ON call_activity(employee_id, started_at DESC);
CREATE TABLE IF NOT EXISTS qa_evaluations (
  id TEXT PRIMARY KEY,
  call_id TEXT REFERENCES call_activity(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  evaluator TEXT NOT NULL,
  evaluation_date TEXT NOT NULL,
  score_opening INTEGER NOT NULL,
  score_empathy INTEGER NOT NULL,
  score_compliance INTEGER NOT NULL,
  score_accuracy INTEGER NOT NULL,
  score_closing INTEGER NOT NULL,
  total_score INTEGER NOT NULL,
  coaching_notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qa_employee_date ON qa_evaluations(employee_id, evaluation_date DESC);
