PRAGMA foreign_keys = ON;

DELETE FROM notices;
DELETE FROM leave_request_events;
DELETE FROM leave_requests;
DELETE FROM employees;
DELETE FROM org_units;

INSERT INTO org_units (id, name, unit_type, parent_id) VALUES
  (1, '대표원장', 'ROOT', NULL),
  (2, '경영지원실', 'DIVISION', 1),
  (3, '원무팀', 'TEAM', 2),
  (4, '인사팀', 'TEAM', 2);

INSERT INTO employees (id, employee_no, name, email, password_hash, joined_at, role, org_unit_id, leader_id, is_active) VALUES
  (1, 'SH-2018-001', '강서준', 'director@sojunghospital.kr', 'sha256$b56338f0c6b52370d13a48f7062c2b8d$0d02dfe63539c34e2d056863a2d3fba7d6d9a61efa41a35a7c7077ea635f4ee0', '2018-03-01', 'DIRECTOR', 1, NULL, 1),
  (2, 'SH-2020-010', '윤하린', 'admin@sojunghospital.kr', 'sha256$575aef3cca9a533ef03da063f2061eae$67de4b26cc97dabc48c89e9477abc1ff121fc0729749d904d469f10f6a00f00d', '2020-05-10', 'ADMIN', 2, 1, 1),
  (3, 'SH-2020-001', '한서윤', 'hr@sojunghospital.kr', 'sha256$c8af78d244e5e256e6a3a6a9aa162921$1be99f6ba6e636ba6e990623bcadcc928eb2a25ba7457a2d8255dda16dc56625', '2020-01-15', 'HR', 4, 1, 1),
  (4, 'SH-2021-004', '박지훈', 'leader@sojunghospital.kr', 'sha256$d4306a026b32e0421348d7367b6b7136$f456c588799f611a0fa35319b1caec65352729dbc808a4ded17ca3479c9ccad2', '2021-07-01', 'LEADER', 3, 1, 1),
  (5, 'SH-2024-013', '김민서', 'minseo@sojunghospital.kr', 'sha256$838ad2aee575fc36747e16853a6c433a$ad065f7cd3f0d5a8aac1757695e9bff9df840dbc32df09d327b3aef81faa100b', '2024-08-19', 'USER', 3, 4, 1),
  (6, 'SH-2023-008', '이유진', 'yujin@sojunghospital.kr', 'sha256$575aef3cca9a533ef03da063f2061eae$67de4b26cc97dabc48c89e9477abc1ff121fc0729749d904d469f10f6a00f00d', '2023-11-06', 'USER', 3, 4, 1);

INSERT INTO leave_requests (
  id, emp_id, type, start_date, end_date, amount, status, reason,
  approved_leader_id, approved_hr_id, approved_director_id, created_at, updated_at
) VALUES
  (1, 5, 'ANNUAL', '2026-04-15', '2026-04-15', 1.0, 'APPROVED_LEADER', '가족 행사 참석', 4, NULL, NULL, '2026-04-07 09:00:00', '2026-04-07 09:30:00'),
  (2, 5, 'HALF_PM', '2026-04-11', '2026-04-11', 0.5, 'PENDING', '치과 진료', NULL, NULL, NULL, '2026-04-08 08:40:00', '2026-04-08 08:40:00'),
  (3, 6, 'SICK', '2026-04-09', '2026-04-10', 0.0, 'PENDING', '진료 및 회복', NULL, NULL, NULL, '2026-04-08 10:00:00', '2026-04-08 10:00:00'),
  (4, 6, 'ANNUAL', '2026-03-20', '2026-03-20', 1.0, 'APPROVED_HR', '개인 일정', 4, 3, NULL, '2026-03-10 13:00:00', '2026-03-10 15:20:00'),
  (5, 4, 'ANNUAL', '2026-04-25', '2026-04-25', 1.0, 'APPROVED_HR', '학회 참석', NULL, 3, NULL, '2026-04-09 10:00:00', '2026-04-09 15:30:00');

INSERT INTO leave_request_events (leave_request_id, actor_id, action, note, created_at) VALUES
  (1, 5, 'REQUEST_CREATED', '가족 행사 참석', '2026-04-07 09:00:00'),
  (1, 4, 'REQUEST_APPROVED', '팀장 승인', '2026-04-07 09:30:00'),
  (2, 5, 'REQUEST_CREATED', '치과 진료', '2026-04-08 08:40:00'),
  (3, 6, 'REQUEST_CREATED', '진료 및 회복', '2026-04-08 10:00:00'),
  (4, 6, 'REQUEST_CREATED', '개인 일정', '2026-03-10 13:00:00'),
  (4, 4, 'REQUEST_APPROVED', '팀장 승인', '2026-03-10 14:00:00'),
  (4, 3, 'REQUEST_APPROVED', '인사 승인', '2026-03-10 15:20:00'),
  (5, 4, 'REQUEST_CREATED', '학회 참석', '2026-04-09 10:00:00'),
  (5, 3, 'REQUEST_APPROVED', '인사 승인', '2026-04-09 15:30:00');

INSERT INTO notices (id, title, content, author_id, created_at, updated_at) VALUES
  (1, '🩺 4월 검진센터 운영 안내', '이번 주 금요일은 검진센터 마감이 30분 앞당겨집니다. 외래 예약표와 연동해 근무 스케줄을 조정해주세요.', 3, '2026-04-12 09:00:00', '2026-04-12 09:00:00'),
  (2, '☕ 원스텝 제안 참여 부탁드립니다', '현장 불편사항이나 아이디어가 있으면 원스텝 제안 버튼으로 바로 남겨주세요. 이모지와 줄바꿈도 그대로 공지에 반영됩니다.', 1, '2026-04-14 08:30:00', '2026-04-14 08:30:00');
