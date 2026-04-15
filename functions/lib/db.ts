import { getNextPendingStage } from "../../src/lib/approval-flow";
import type { LeaveRequestItem, NoticeItem, SessionUser } from "../../src/types";

export type UserRole = "USER" | "LEADER" | "HR" | "ADMIN" | "DIRECTOR";
export type LeaveType = "ANNUAL" | "HALF_AM" | "HALF_PM" | "SICK";
export type LeaveStatus = "PENDING" | "APPROVED_LEADER" | "APPROVED_HR" | "APPROVED_DIRECTOR" | "REJECTED";

export interface EmployeeRecord {
  id: number;
  employee_no: string;
  name: string;
  email: string;
  joined_at: string;
  role: UserRole;
  password_hash: string;
  leader_id: number | null;
  is_active: number;
  team_name: string | null;
  division_name: string | null;
  root_name: string | null;
}

export interface LeaveRow {
  id: number;
  emp_id: number;
  employee_no: string;
  employee_name: string;
  team_name: string | null;
  requester_role: UserRole;
  requester_has_leader: number;
  requester_leader_id: number | null;
  type: LeaveType;
  start_date: string;
  end_date: string;
  amount: number;
  reason: string;
  status: LeaveStatus;
  created_at: string;
  leader_name: string | null;
  hr_name: string | null;
  director_name: string | null;
}

interface NoticeRow {
  id: number;
  title: string;
  content: string;
  created_at: string;
  author_name: string;
  author_role: UserRole;
}

const leaveSelect = `
  SELECT
    lr.id,
    lr.emp_id,
    e.employee_no,
    e.name AS employee_name,
    team.name AS team_name,
    e.role AS requester_role,
    CASE WHEN e.leader_id IS NOT NULL THEN 1 ELSE 0 END AS requester_has_leader,
    e.leader_id AS requester_leader_id,
    lr.type,
    lr.start_date,
    lr.end_date,
    lr.amount,
    lr.reason,
    lr.status,
    lr.created_at,
    leader.name AS leader_name,
    hr.name AS hr_name,
    director.name AS director_name
  FROM leave_requests lr
  INNER JOIN employees e ON e.id = lr.emp_id
  LEFT JOIN employees leader ON leader.id = lr.approved_leader_id
  LEFT JOIN employees hr ON hr.id = lr.approved_hr_id
  LEFT JOIN employees director ON director.id = lr.approved_director_id
  LEFT JOIN org_units team ON team.id = e.org_unit_id
`;

export async function getEmployeeByEmployeeNo(db: D1Database, employeeNo: string) {
  return db
    .prepare(
      `
        SELECT
          e.*,
          team.name AS team_name,
          division.name AS division_name,
          root.name AS root_name
        FROM employees e
        LEFT JOIN org_units team ON team.id = e.org_unit_id
        LEFT JOIN org_units division ON division.id = team.parent_id
        LEFT JOIN org_units root ON root.id = division.parent_id
        WHERE e.employee_no = ?
      `,
    )
    .bind(employeeNo)
    .first<EmployeeRecord>();
}

export async function getEmployeeById(db: D1Database, id: number) {
  return db
    .prepare(
      `
        SELECT
          e.*,
          team.name AS team_name,
          division.name AS division_name,
          root.name AS root_name
        FROM employees e
        LEFT JOIN org_units team ON team.id = e.org_unit_id
        LEFT JOIN org_units division ON division.id = team.parent_id
        LEFT JOIN org_units root ON root.id = division.parent_id
        WHERE e.id = ?
      `,
    )
    .bind(id)
    .first<EmployeeRecord>();
}

export function toSessionUser(record: EmployeeRecord): SessionUser {
  return {
    id: record.id,
    employeeNo: record.employee_no,
    name: record.name,
    email: record.email,
    role: record.role,
    joinedAt: record.joined_at,
    teamName: record.team_name ?? "",
    orgPath: [record.root_name, record.division_name, record.team_name].filter(Boolean) as string[],
  };
}

export async function listCycleLeaveRows(db: D1Database, employeeId: number, cycleStart: string, cycleEnd: string) {
  const result = await db
    .prepare(
      `
        SELECT type, status, amount
        FROM leave_requests
        WHERE emp_id = ?
          AND date(end_date) >= date(?)
          AND date(start_date) < date(?)
        ORDER BY start_date DESC
      `,
    )
    .bind(employeeId, cycleStart, cycleEnd)
    .all<{ type: LeaveType; status: LeaveStatus; amount: number }>();

  return result.results;
}

export async function listHistoryVisibleToActor(db: D1Database, actor: EmployeeRecord) {
  let sql = leaveSelect;
  const bindings: Array<number | string> = [];

  if (actor.role === "USER") {
    sql += " WHERE lr.emp_id = ?";
    bindings.push(actor.id);
  } else if (actor.role === "LEADER") {
    sql += " WHERE lr.emp_id = ? OR e.leader_id = ?";
    bindings.push(actor.id, actor.id);
  }

  sql += " ORDER BY lr.created_at DESC";

  const result = await db.prepare(sql).bind(...bindings).all<LeaveRow>();
  return result.results.map(toLeaveItem);
}

function canActorApproveRow(actor: EmployeeRecord, row: LeaveRow) {
  const nextStage = getNextPendingStage(row.requester_role, row.requester_has_leader === 1, row.status);
  if (!nextStage) {
    return false;
  }

  if (nextStage === "LEADER") {
    return actor.role === "LEADER" && row.requester_leader_id === actor.id && row.emp_id !== actor.id;
  }

  if (nextStage === "HR") {
    return actor.role === "HR" || actor.role === "ADMIN";
  }

  return actor.role === "DIRECTOR";
}

export async function listPendingApprovalsForActor(db: D1Database, actor: EmployeeRecord) {
  if (!["LEADER", "HR", "ADMIN", "DIRECTOR"].includes(actor.role)) {
    return [];
  }

  const result = await db
    .prepare(`${leaveSelect} WHERE lr.status IN ('PENDING', 'APPROVED_LEADER', 'APPROVED_HR') ORDER BY lr.created_at ASC`)
    .all<LeaveRow>();

  return result.results.filter((row) => canActorApproveRow(actor, row)).map(toLeaveItem);
}

export async function getLeaveRequestRowById(db: D1Database, requestId: number) {
  return db
    .prepare(`${leaveSelect} WHERE lr.id = ?`)
    .bind(requestId)
    .first<LeaveRow>();
}

export async function insertLeaveRequest(
  db: D1Database,
  input: {
    employeeId: number;
    type: LeaveType;
    startDate: string;
    endDate: string;
    amount: number;
    reason: string;
    actorId: number;
    cycleStart?: string;
    cycleEnd?: string;
    entitlement?: number;
  },
): Promise<number | null> {
  const insertStatement =
    input.type === "SICK"
      ? db
          .prepare(
            `
              INSERT INTO leave_requests (emp_id, type, start_date, end_date, amount, status, reason)
              VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
            `,
          )
          .bind(input.employeeId, input.type, input.startDate, input.endDate, input.amount, input.reason)
      : db
          .prepare(
            `
              INSERT INTO leave_requests (emp_id, type, start_date, end_date, amount, status, reason)
              SELECT ?, ?, ?, ?, ?, 'PENDING', ?
              WHERE COALESCE(
                (
                  SELECT SUM(
                    CASE
                      WHEN type != 'SICK' AND status != 'REJECTED' THEN amount
                      ELSE 0
                    END
                  )
                  FROM leave_requests
                  WHERE emp_id = ?
                    AND date(end_date) >= date(?)
                    AND date(start_date) < date(?)
                ),
                0
              ) + ? <= ?
            `,
          )
          .bind(
            input.employeeId,
            input.type,
            input.startDate,
            input.endDate,
            input.amount,
            input.reason,
            input.employeeId,
            input.cycleStart ?? null,
            input.cycleEnd ?? null,
            input.amount,
            input.entitlement ?? null,
          );

  const [insertResult] = await db.batch([
    insertStatement,
    db
      .prepare(
        `
          INSERT INTO leave_request_events (leave_request_id, actor_id, action, note)
          SELECT last_insert_rowid(), ?, 'REQUEST_CREATED', ?
          WHERE changes() > 0
        `,
      )
      .bind(input.actorId, input.reason),
  ]);

  if (insertResult.meta.changes < 1) {
    return null;
  }

  return Number(insertResult.meta.last_row_id);
}

export async function updateLeaveRequestStatus(
  db: D1Database,
  input: {
    requestId: number;
    currentStatus: LeaveStatus;
    status: LeaveStatus;
    leaderId?: number | null;
    hrId?: number | null;
    directorId?: number | null;
    actorId: number;
    eventAction: string;
    note?: string;
  },
): Promise<boolean> {
  const [updateResult] = await db.batch([
    db
      .prepare(
        `
          UPDATE leave_requests
          SET
            status = ?,
            approved_leader_id = COALESCE(?, approved_leader_id),
            approved_hr_id = COALESCE(?, approved_hr_id),
            approved_director_id = COALESCE(?, approved_director_id),
            approval_note = COALESCE(?, approval_note),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND status = ?
        `,
      )
      .bind(
        input.status,
        input.leaderId ?? null,
        input.hrId ?? null,
        input.directorId ?? null,
        input.note ?? null,
        input.requestId,
        input.currentStatus,
      ),
    db
      .prepare(
        `
          INSERT INTO leave_request_events (leave_request_id, actor_id, action, note)
          SELECT ?, ?, ?, ?
          WHERE changes() > 0
        `,
      )
      .bind(input.requestId, input.actorId, input.eventAction, input.note ?? null),
  ]);

  return updateResult.meta.changes > 0;
}

export async function listNotices(db: D1Database) {
  const result = await db
    .prepare(
      `
        SELECT
          n.id,
          n.title,
          n.content,
          n.created_at,
          e.name AS author_name,
          e.role AS author_role
        FROM notices n
        INNER JOIN employees e ON e.id = n.author_id
        ORDER BY n.created_at DESC
        LIMIT 20
      `,
    )
    .all<NoticeRow>();

  return result.results.map(toNoticeItem);
}

export async function getNoticeById(db: D1Database, noticeId: number) {
  return db
    .prepare(
      `
        SELECT
          n.id,
          n.title,
          n.content,
          n.created_at,
          e.name AS author_name,
          e.role AS author_role
        FROM notices n
        INNER JOIN employees e ON e.id = n.author_id
        WHERE n.id = ?
      `,
    )
    .bind(noticeId)
    .first<NoticeRow>();
}

export async function insertNotice(
  db: D1Database,
  input: {
    title: string;
    content: string;
    authorId: number;
  },
) {
  const result = await db
    .prepare(
      `
        INSERT INTO notices (title, content, author_id)
        VALUES (?, ?, ?)
      `,
    )
    .bind(input.title, input.content, input.authorId)
    .run();

  return Number(result.meta.last_row_id);
}

export function toLeaveItem(row: LeaveRow): LeaveRequestItem {
  return {
    id: row.id,
    employeeId: row.emp_id,
    employeeNo: row.employee_no,
    employeeName: row.employee_name,
    teamName: row.team_name ?? "-",
    requesterRole: row.requester_role,
    requesterHasLeader: row.requester_has_leader === 1,
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    amount: row.amount,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    leaderName: row.leader_name,
    hrName: row.hr_name,
    directorName: row.director_name,
  };
}

function toNoticeItem(row: NoticeRow): NoticeItem {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    authorName: row.author_name,
    authorRole: row.author_role,
    createdAt: row.created_at,
  };
}
