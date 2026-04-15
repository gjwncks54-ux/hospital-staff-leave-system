import type { LeaveRequestItem, SessionUser } from "../../src/types";

export type UserRole = "USER" | "LEADER" | "HR" | "ADMIN" | "DIRECTOR";
export type LeaveType = "ANNUAL" | "HALF_AM" | "HALF_PM" | "SICK";
export type LeaveStatus = "PENDING" | "APPROVED_LEADER" | "APPROVED_HR" | "REJECTED";

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
  type: LeaveType;
  start_date: string;
  end_date: string;
  amount: number;
  reason: string;
  status: LeaveStatus;
  created_at: string;
  leader_name: string | null;
  hr_name: string | null;
}

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

export async function listHistoryForEmployee(db: D1Database, employeeId: number) {
  const result = await db
    .prepare(
      `
        SELECT
          lr.id,
          lr.emp_id,
          e.employee_no,
          e.name AS employee_name,
          team.name AS team_name,
          lr.type,
          lr.start_date,
          lr.end_date,
          lr.amount,
          lr.reason,
          lr.status,
          lr.created_at,
          leader.name AS leader_name,
          hr.name AS hr_name
        FROM leave_requests lr
        INNER JOIN employees e ON e.id = lr.emp_id
        LEFT JOIN employees leader ON leader.id = lr.approved_leader_id
        LEFT JOIN employees hr ON hr.id = lr.approved_hr_id
        LEFT JOIN org_units team ON team.id = e.org_unit_id
        WHERE lr.emp_id = ?
        ORDER BY lr.created_at DESC
      `,
    )
    .bind(employeeId)
    .all<LeaveRow>();

  return result.results.map(toLeaveItem);
}

export async function listPendingApprovalsForActor(db: D1Database, actor: EmployeeRecord) {
  let sql = `
    SELECT
      lr.id,
      lr.emp_id,
      e.employee_no,
      e.name AS employee_name,
      team.name AS team_name,
      lr.type,
      lr.start_date,
      lr.end_date,
      lr.amount,
      lr.reason,
      lr.status,
      lr.created_at,
      leader.name AS leader_name,
      hr.name AS hr_name
    FROM leave_requests lr
    INNER JOIN employees e ON e.id = lr.emp_id
    LEFT JOIN employees leader ON leader.id = lr.approved_leader_id
    LEFT JOIN employees hr ON hr.id = lr.approved_hr_id
    LEFT JOIN org_units team ON team.id = e.org_unit_id
  `;

  const bindings: Array<number | string> = [];

  if (actor.role === "LEADER") {
    sql += " WHERE lr.status = 'PENDING' AND e.leader_id = ? AND lr.emp_id != ?";
    bindings.push(actor.id, actor.id);
  } else if (actor.role === "HR") {
    sql += " WHERE lr.status = 'APPROVED_LEADER'";
  } else if (actor.role === "ADMIN" || actor.role === "DIRECTOR") {
    sql += " WHERE lr.status IN ('PENDING', 'APPROVED_LEADER')";
  } else {
    return [];
  }

  sql += " ORDER BY lr.created_at ASC";

  const result = await db.prepare(sql).bind(...bindings).all<LeaveRow>();
  return result.results.map(toLeaveItem);
}

export async function getLeaveRequestRowById(db: D1Database, requestId: number) {
  return db
    .prepare(
      `
        SELECT
          lr.id,
          lr.emp_id,
          e.employee_no,
          e.name AS employee_name,
          team.name AS team_name,
          lr.type,
          lr.start_date,
          lr.end_date,
          lr.amount,
          lr.reason,
          lr.status,
          lr.created_at,
          leader.name AS leader_name,
          hr.name AS hr_name
        FROM leave_requests lr
        INNER JOIN employees e ON e.id = lr.emp_id
        LEFT JOIN employees leader ON leader.id = lr.approved_leader_id
        LEFT JOIN employees hr ON hr.id = lr.approved_hr_id
        LEFT JOIN org_units team ON team.id = e.org_unit_id
        WHERE lr.id = ?
      `,
    )
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
                      WHEN type != 'SICK' AND status = 'APPROVED_HR' THEN amount
                      WHEN type != 'SICK' AND status IN ('PENDING', 'APPROVED_LEADER') THEN amount
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

export function toLeaveItem(row: LeaveRow): LeaveRequestItem {
  return {
    id: row.id,
    employeeId: row.emp_id,
    employeeNo: row.employee_no,
    employeeName: row.employee_name,
    teamName: row.team_name ?? "-",
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    amount: row.amount,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    leaderName: row.leader_name,
    hrName: row.hr_name,
  };
}
