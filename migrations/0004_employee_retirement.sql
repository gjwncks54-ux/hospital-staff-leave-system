PRAGMA foreign_keys = OFF;

ALTER TABLE employees ADD COLUMN retired_at TEXT;

PRAGMA foreign_keys = ON;
