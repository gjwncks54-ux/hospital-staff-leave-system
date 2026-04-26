CREATE TABLE IF NOT EXISTS employee_leave_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  previous_adjustment_days REAL NOT NULL,
  new_adjustment_days REAL NOT NULL,
  delta_days REAL NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employee_leave_adjustments_employee_created_at
  ON employee_leave_adjustments(employee_id, created_at DESC);
