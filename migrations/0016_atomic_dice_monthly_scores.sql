DROP TRIGGER IF EXISTS trg_dice_rolls_sync_monthly_score;

CREATE TRIGGER trg_dice_rolls_sync_monthly_score
AFTER INSERT ON dice_rolls
WHEN NEW.roll_score > 0
BEGIN
  INSERT INTO dice_monthly_scores (month_start, employee_no, score, rolls, attempts, updated_at)
  SELECT
    substr(NEW.roll_date, 1, 7) || '-01',
    NEW.employee_no,
    COALESCE(SUM(daily_score), 0),
    COUNT(*),
    COALESCE(SUM(attempts), 0),
    CURRENT_TIMESTAMP
  FROM (
    SELECT
      roll_date,
      MAX(roll_score) AS daily_score,
      COUNT(*) AS attempts
    FROM dice_rolls
    WHERE employee_no = NEW.employee_no
      AND roll_date >= substr(NEW.roll_date, 1, 7) || '-01'
      AND roll_date < date(substr(NEW.roll_date, 1, 7) || '-01', '+1 month')
      AND roll_score > 0
    GROUP BY roll_date
  )
  WHERE true
  ON CONFLICT(month_start, employee_no) DO UPDATE SET
    score = excluded.score,
    rolls = excluded.rolls,
    attempts = excluded.attempts,
    updated_at = CURRENT_TIMESTAMP;
END;

-- Repair any score rows that predate the atomic insert trigger.
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
