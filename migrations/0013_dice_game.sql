CREATE TABLE IF NOT EXISTS dice_bonuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_no TEXT NOT NULL,
  reason TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dice_rolls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_no TEXT NOT NULL,
  roll_date TEXT NOT NULL CHECK (roll_date LIKE '____-__-__'),
  roll_value INTEGER NOT NULL CHECK (roll_value BETWEEN 1 AND 6),
  roll_kind TEXT NOT NULL DEFAULT 'REGULAR' CHECK (roll_kind IN ('REGULAR', 'BONUS')),
  bonus_id INTEGER REFERENCES dice_bonuses(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dice_rolls_employee_date
  ON dice_rolls(employee_no, roll_date);

CREATE INDEX IF NOT EXISTS idx_dice_rolls_roll_date
  ON dice_rolls(roll_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dice_rolls_regular_once
  ON dice_rolls(employee_no, roll_date, roll_kind)
  WHERE roll_kind = 'REGULAR';

CREATE UNIQUE INDEX IF NOT EXISTS idx_dice_rolls_bonus_once
  ON dice_rolls(bonus_id)
  WHERE bonus_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dice_bonuses_employee_used
  ON dice_bonuses(employee_no, used, created_at);
