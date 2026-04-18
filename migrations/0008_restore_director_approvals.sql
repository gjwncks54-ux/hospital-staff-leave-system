-- 0003_workflow_notices.sql 마이그레이션에서 누락된 approved_director_id를
-- leave_request_events 기록을 통해 복구하는 보완 마이그레이션.
UPDATE leave_requests
SET approved_director_id = (
  SELECT lre.actor_id
  FROM leave_request_events lre
  JOIN employees e ON e.id = lre.actor_id
  WHERE lre.leave_request_id = leave_requests.id
    AND lre.action = 'REQUEST_APPROVED'
    AND e.role IN ('DIRECTOR', 'ADMIN')
  ORDER BY lre.id DESC
  LIMIT 1
)
WHERE approved_director_id IS NULL
  AND status IN ('APPROVED_DIRECTOR', 'CANCELLED');
