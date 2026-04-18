import { getNextPendingStage } from "../../src/lib/approval-flow";
import type { LeaveRequestItem, ManagedEmployeeItem, NoticeItem, OrgUnitItem, SessionUser } from "../../src/types";

export type UserRole = "USER" | "LEADER" | "HR" | "ADMIN" | "DIRECTOR";
export type LeaveType = "ANNUAL" | "HALF_AM" | "HALF_PM" | "SICK" | "UNPAID";
export type LeaveStatus = "PENDING" | "APPROVED_LEADER" | "APPROVED_HR" | "APPROVED_DIRECTOR" | "REJECTED" | "CANCELLED";

export interface EmployeeRecord {
  id: number;
  employee_no: string;
  name: string;
  email: string;
  joined_at: string;
  leave_adjustment_days: number;
  retired_at: string | null;
  role: UserRole;
  password_hash: string;
  leader_id: number | null;
  is_active: number;
  org_unit_id: number | null;
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
  approved_leader_id: number | null;
  approved_hr_id: number | null;
  approved_director_id: number | null;
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

interface ManagedEmployeeRow {
  id: number;
  employee_no: string;
  name: string;
  email: string;
  joined_at: string;
  leave_adjustment_days: number;
  retired_at: string | null;
  role: UserRole;
  is_active: number;
  org_unit_id: number | null;
  unit_name: string | null;
  parent_name: string | null;
  grand_name: string | null;
  leader_id: number | null;
  leader_name: string | null;
}

interface OrgUnitRow {
  id: number;
  name: string;
  unit_type: "ROOT" | "DIVISION" | "TEAM";
  parent_id: number | null;
  parent_name: string | null;
  grand_name: string | null;
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
    lr.approved_leader_id,
    lr.approved_hr_id,
    lr.approved_director_id,
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

export async function getEmployeeByEmail(db: D1Database, email: string) {
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
        WHERE lower(e.email) = lower(?)
      `,
    )
    .bind(email)
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

export async function getOrgUnitById(db: D1Database, id: number) {
  return db
    .prepare(
      `
        SELECT
          id,
          name,
          unit_type,
          parent_id
        FROM org_units
        WHERE id = ?
      `,
    )
    .bind(id)
    .first<{ id: number; name: string; unit_type: "ROOT" | "DIVISION" | "TEAM"; parent_id: number | null }>();
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
        SELECT type, status, amount, start_date, end_date
        FROM leave_requests
        WHERE emp_id = ?
          AND date(end_date) >= date(?)
          AND date(start_date) < date(?)
        ORDER BY start_date DESC
      `,
    )
    .bind(employeeId, cycleStart, cycleEnd)
    .all<{ type: LeaveType; status: LeaveStatus; amount: number; start_date: string; end_date: string }>();

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

export async function listEmployeesForManagement(db: D1Database) {
  const result = await db
    .prepare(
      `
        SELECT
          e.id,
          e.employee_no,
          e.name,
          e.email,
          e.joined_at,
          e.leave_adjustment_days,
          e.retired_at,
          e.role,
          e.is_active,
          e.org_unit_id,
          unit.name AS unit_name,
          parent.name AS parent_name,
          grand.name AS grand_name,
          e.leader_id,
          leader.name AS leader_name
        FROM employees e
        LEFT JOIN org_units unit ON unit.id = e.org_unit_id
        LEFT JOIN org_units parent ON parent.id = unit.parent_id
        LEFT JOIN org_units grand ON grand.id = parent.parent_id
        LEFT JOIN employees leader ON leader.id = e.leader_id
        ORDER BY e.is_active DESC, e.name COLLATE NOCASE ASC
      `,
    )
    .all<ManagedEmployeeRow>();

  return result.results.map(toManagedEmployeeItem);
}

export async function listOrgUnits(db: D1Database) {
  const result = await db
    .prepare(
      `
        SELECT
          unit.id,
          unit.name,
          unit.unit_type,
          unit.parent_id,
          parent.name AS parent_name,
          grand.name AS grand_name
        FROM org_units unit
        LEFT JOIN org_units parent ON parent.id = unit.parent_id
        LEFT JOIN org_units grand ON grand.id = parent.parent_id
        ORDER BY
          CASE unit.unit_type
            WHEN 'ROOT' THEN 1
            WHEN 'DIVISION' THEN 2
            ELSE 3
          END,
          unit.name COLLATE NOCASE ASC
      `,
    )
    .all<OrgUnitRow>();

  return result.results.map(toOrgUnitItem);
}

export async function updateEmployeeForManagement(
  db: D1Database,
  input: {
    employeeId: number;
    joinedAt: string;
    retiredAt: string | null;
    role: UserRole;
    orgUnitId: number | null;
    leaderId: number | null;
    isActive: boolean;
    passwordHash?: string | null;
  },
) {
  const result = await db
    .prepare(
      `
        UPDATE employees
        SET
          joined_at = ?,
          retired_at = ?,
          role = ?,
          org_unit_id = ?,
          leader_id = ?,
          password_hash = COALESCE(?, password_hash),
          is_active = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    )
    .bind(
      input.joinedAt,
      input.retiredAt,
      input.role,
      input.orgUnitId,
      input.leaderId,
      input.passwordHash ?? null,
      input.isActive ? 1 : 0,
      input.employeeId,
    )
    .run();

  return result.meta.changes > 0;
}

export async function countActiveDirectReports(db: D1Database, employeeId: number) {
  const result = await db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM employees
        WHERE leader_id = ?
          AND is_active = 1
      `,
    )
    .bind(employeeId)
    .first<{ count: number }>();

  return Number(result?.count ?? 0);
}

export async function updateEmployeePasswordHash(db: D1Database, employeeId: number, passwordHash: string) {
  const result = await db
    .prepare(
      `
        UPDATE employees
        SET
          password_hash = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    )
    .bind(passwordHash, employeeId)
    .run();

  return result.meta.changes > 0;
}

export async function createEmployeeForManagement(
  db: D1Database,
  input: {
    employeeNo: string;
    name: string;
    email: string;
    passwordHash: string;
    joinedAt: string;
    role: UserRole;
    orgUnitId: number | null;
    leaderId: number | null;
    isActive: boolean;
    retiredAt: string | null;
  },
) {
  const result = await db
    .prepare(
      `
        INSERT INTO employees (
          employee_no,
          name,
          email,
          password_hash,
          joined_at,
          retired_at,
          role,
          org_unit_id,
          leader_id,
          is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.employeeNo,
      input.name,
      input.email,
      input.passwordHash,
      input.joinedAt,
      input.retiredAt,
      input.role,
      input.orgUnitId,
      input.leaderId,
      input.isActive ? 1 : 0,
    )
    .run();

  return Number(result.meta.last_row_id);
}

function canActorApproveRow(actor: EmployeeRecord, row: LeaveRow) {
  const nextStage = getNextPendingStage(row.requester_role, row.requester_has_leader === 1, row.status);
  if (!nextStage) {
    return false;
  }

  if (actor.role === "ADMIN" || actor.role === "DIRECTOR") {
    return true;
  }

  if (nextStage === "LEADER") {
    return actor.role === "LEADER" && row.requester_leader_id === actor.id && row.emp_id !== actor.id;
  }

  if (nextStage === "HR") {
    return actor.role === "HR";
  }

  return false;
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
    input.type === "SICK" || input.type === "UNPAID"
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
                      WHEN type NOT IN ('SICK', 'UNPAID') AND status NOT IN ('REJECTED', 'CANCELLED') THEN amount
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

export async function updateNotice(
  db: D1Database,
  input: {
    noticeId: number;
    title: string;
    content: string;
  },
) {
  const result = await db
    .prepare(
      `
        UPDATE notices
        SET
          title = ?,
          content = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    )
    .bind(input.title, input.content, input.noticeId)
    .run();

  return result.meta.changes > 0;
}

export async function getManagedEmployeeById(db: D1Database, employeeId: number) {
  const result = await db
    .prepare(
      `
        SELECT
          e.id,
          e.employee_no,
          e.name,
          e.email,
          e.joined_at,
          e.leave_adjustment_days,
          e.retired_at,
          e.role,
          e.is_active,
          e.org_unit_id,
          unit.name AS unit_name,
          parent.name AS parent_name,
          grand.name AS grand_name,
          e.leader_id,
          leader.name AS leader_name
        FROM employees e
        LEFT JOIN org_units unit ON unit.id = e.org_unit_id
        LEFT JOIN org_units parent ON parent.id = unit.parent_id
        LEFT JOIN org_units grand ON grand.id = parent.parent_id
        LEFT JOIN employees leader ON leader.id = e.leader_id
        WHERE e.id = ?
      `,
    )
    .bind(employeeId)
    .first<ManagedEmployeeRow>();

  return result ? toManagedEmployeeItem(result) : null;
}

export async function deleteNotice(db: D1Database, noticeId: number) {
  const result = await db
    .prepare(
      `
        DELETE FROM notices
        WHERE id = ?
      `,
    )
    .bind(noticeId)
    .run();

  return result.meta.changes > 0;
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
    approvedLeaderId: row.approved_leader_id,
    approvedHrId: row.approved_hr_id,
    approvedDirectorId: row.approved_director_id,
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

function buildOrgPath(names: Array<string | null | undefined>) {
  return names.filter((value): value is string => Boolean(value));
}

function toManagedEmployeeItem(row: ManagedEmployeeRow): ManagedEmployeeItem {
  const orgPath = buildOrgPath([row.grand_name, row.parent_name, row.unit_name]);

  return {
    id: row.id,
    employeeNo: row.employee_no,
    name: row.name,
    email: row.email,
    role: row.role,
    joinedAt: row.joined_at,
    leaveAdjustmentDays: row.leave_adjustment_days ?? 0,
    retiredAt: row.retired_at,
    isActive: row.is_active === 1,
    orgUnitId: row.org_unit_id,
    teamName: row.unit_name ?? "미지정",
    orgPath,
    leaderId: row.leader_id,
    leaderName: row.leader_name,
  };
}

function toOrgUnitItem(row: OrgUnitRow): OrgUnitItem {
  return {
    id: row.id,
    name: row.name,
    unitType: row.unit_type,
    parentId: row.parent_id,
    path: buildOrgPath([row.grand_name, row.parent_name, row.name]),
  };
}
