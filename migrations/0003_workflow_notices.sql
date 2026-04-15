PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS leave_requests_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('ANNUAL', 'HALF_AM', 'HALF_PM', 'SICK')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED_LEADER', 'APPROVED_HR', 'APPROVED_DIRECTOR', 'REJECTED')),
  reason TEXT NOT NULL,
  approval_note TEXT,
  approved_leader_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  approved_hr_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  approved_director_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO leave_requests_new (
  id, emp_id, type, start_date, end_date, amount, status, reason,
  approval_note, approved_leader_id, approved_hr_id, created_at, updated_at
)
SELECT
  id, emp_id, type, start_date, end_date, amount, status, reason,
  approval_note, approved_leader_id, approved_hr_id, created_at, updated_at
FROM leave_requests;

DROP TABLE leave_requests;
ALTER TABLE leave_requests_new RENAME TO leave_requests;

CREATE INDEX IF NOT EXISTS idx_leave_requests_emp_id ON leave_requests(emp_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_date_window ON leave_requests(start_date, end_date);

CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notices_created_at ON notices(created_at DESC);

PRAGMA foreign_keys = ON;
