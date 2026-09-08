CREATE TABLE IF NOT EXISTS dice_monthly_scores (
  month_start TEXT NOT NULL CHECK (month_start LIKE '____-__-__'),
  employee_no TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
  rolls INTEGER NOT NULL DEFAULT 0 CHECK (rolls >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (month_start, employee_no)
);

CREATE INDEX IF NOT EXISTS idx_dice_monthly_scores_month_score
  ON dice_monthly_scores(month_start, score DESC, employee_no);

INSERT INTO dice_monthly_scores (month_start, employee_no, score, rolls, attempts, updated_at)
SELECT
  month_start,
  employee_no,
  SUM(daily_score) AS score,
  COUNT(*) AS rolls,
  SUM(attempts) AS attempts,
  CURRENT_TIMESTAMP
FROM (
  SELECT
    substr(roll_date, 1, 7) || '-01' AS month_start,
    employee_no,
    roll_date,
    MAX(roll_score) AS daily_score,
    COUNT(*) AS attempts
  FROM dice_rolls
  WHERE roll_score > 0
  GROUP BY month_start, employee_no, roll_date
)
GROUP BY month_start, employee_no
ON CONFLICT(month_start, employee_no) DO UPDATE SET
  score = excluded.score,
  rolls = excluded.rolls,
  attempts = excluded.attempts,
  updated_at = CURRENT_TIMESTAMP;
