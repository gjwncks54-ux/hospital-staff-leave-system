PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS org_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit_type TEXT NOT NULL CHECK (unit_type IN ('ROOT', 'DIVISION', 'TEAM')),
  parent_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('USER', 'LEADER', 'HR', 'ADMIN', 'DIRECTOR')),
  org_unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  leader_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('ANNUAL', 'HALF_AM', 'HALF_PM', 'SICK')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED_LEADER', 'APPROVED_HR', 'REJECTED')),
  reason TEXT NOT NULL,
  approval_note TEXT,
  approved_leader_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  approved_hr_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leave_request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leave_request_id INTEGER NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employees_employee_no ON employees(employee_no);
CREATE INDEX IF NOT EXISTS idx_employees_leader_id ON employees(leader_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_emp_id ON leave_requests(emp_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_date_window ON leave_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_request_events_request_id ON leave_request_events(leave_request_id);
