ALTER TABLE leave_requests ADD COLUMN requester_role TEXT;
ALTER TABLE leave_requests ADD COLUMN requester_has_leader INTEGER;
ALTER TABLE leave_requests ADD COLUMN requester_leader_id INTEGER;

-- Backfill from current employee state (best effort for historical rows)
UPDATE leave_requests
SET
  requester_role = (SELECT role FROM employees WHERE id = leave_requests.emp_id),
  requester_has_leader = (
    SELECT CASE WHEN leader_id IS NOT NULL THEN 1 ELSE 0 END
    FROM employees WHERE id = leave_requests.emp_id
  ),
  requester_leader_id = (SELECT leader_id FROM employees WHERE id = leave_requests.emp_id)
WHERE requester_role IS NULL;
