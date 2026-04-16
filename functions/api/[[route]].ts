import { Hono } from "hono";
import { z } from "zod";
import { getApprovalStages, getNextPendingStage, getStatusAfterStage } from "../../src/lib/approval-flow";
import { authGuard, clearSession, hashPassword, serializeEmployee, setSession, verifyPassword } from "../lib/auth";
import {
  createEmployeeForManagement,
  deleteNotice,
  getEmployeeByEmployeeNo,
  getEmployeeByEmail,
  getEmployeeById,
  getManagedEmployeeById,
  getOrgUnitById,
  getLeaveRequestRowById,
  getNoticeById,
  insertLeaveRequest,
  insertNotice,
  listCycleLeaveRows,
  listEmployeesForManagement,
  listHistoryVisibleToActor,
  listNotices,
  listOrgUnits,
  listPendingApprovalsForActor,
  toLeaveItem,
  updateEmployeeForManagement,
  updateLeaveRequestStatus,
  updateNotice,
  type EmployeeRecord,
  type LeaveStatus,
} from "../lib/db";
import { buildLeaveSummary, calculateLeaveCycle, calculateRequestAmount, consumesAnnualBalance } from "../lib/leave";
import { handle } from "hono/cloudflare-pages";

type AppEnv = {
  Bindings: {
    DB: D1Database;
    JWT_SECRET: string;
    SESSION_COOKIE_NAME?: string;
  };
  Variables: {
    employee: EmployeeRecord;
  };
};

const loginSchema = z.object({
  employeeNo: z.string().trim().min(4),
  password: z.string().min(8),
});

const requestSchema = z.object({
  type: z.enum(["ANNUAL", "HALF_AM", "HALF_PM", "SICK"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(2).max(500),
});

const approvalSchema = z.object({
  requestId: z.number().int().positive(),
  action: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(500).optional(),
});

const noticeSchema = z.object({
  title: z.string().trim().min(2).max(80),
  content: z.string().trim().min(2).max(1000),
});

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const employeeUpdateSchema = z.object({
  joinedAt: z.string().regex(datePattern),
  retiredAt: z.union([z.string().regex(datePattern), z.null()]),
  orgUnitId: z.number().int().positive().nullable(),
  leaderId: z.number().int().positive().nullable(),
  isActive: z.boolean(),
});

const employeeCreateSchema = z.object({
  employeeNo: z.string().trim().min(4).max(32),
  name: z.string().trim().min(2).max(40),
  email: z.string().trim().email().max(120),
  password: z.string().min(8).max(100),
  joinedAt: z.string().regex(datePattern),
  role: z.enum(["USER", "LEADER", "HR", "ADMIN", "DIRECTOR"]),
  orgUnitId: z.number().int().positive().nullable(),
  leaderId: z.number().int().positive().nullable(),
  isActive: z.boolean(),
});

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

app.get("/api/health", (c) => c.json({ ok: true, date: "2026-04-16" }));

app.post("/api/auth/login", async (c) => {
  try {
    const body = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ message: "사번과 비밀번호를 다시 확인해 주세요." }, 400);
    }

    const employee = await getEmployeeByEmployeeNo(c.env.DB, body.data.employeeNo);
    if (!employee || employee.is_active !== 1) {
      return c.json({ message: "활성화된 계정을 찾을 수 없습니다." }, 401);
    }

    const passwordOk = await verifyPassword(body.data.password, employee.password_hash);
    if (!passwordOk) {
      return c.json({ message: "비밀번호가 올바르지 않습니다." }, 401);
    }

    await setSession(c.env, c.req.url, employee, c);
    return c.json({ user: serializeEmployee(employee) });
  } catch (error) {
    console.error("LOGIN_ROUTE_ERROR", error);
    return c.json({ message: "로그인 처리 중 오류가 발생했습니다." }, 500);
  }
});

app.post("/api/auth/logout", authGuard(), async (c) => {
  clearSession(c.env, c);
  return c.json({ ok: true });
});

app.get("/api/auth/session", authGuard(), async (c) => {
  return c.json({ user: serializeEmployee(c.get("employee")) });
});

app.get("/api/notices", authGuard(), async (c) => {
  const items = await listNotices(c.env.DB);
  return c.json({ items });
});

app.post("/api/notices", authGuard(["ADMIN", "DIRECTOR"]), async (c) => {
  const actor = c.get("employee");
  const body = noticeSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ message: "공지 제목과 내용을 다시 확인해 주세요." }, 400);
  }

  const noticeId = await insertNotice(c.env.DB, {
    title: body.data.title,
    content: body.data.content,
    authorId: actor.id,
  });

  const notice = await getNoticeById(c.env.DB, noticeId);
  return c.json({ item: notice ?? null }, 201);
});

app.patch("/api/notices/:noticeId", authGuard(["ADMIN", "DIRECTOR"]), async (c) => {
  const noticeId = Number(c.req.param("noticeId"));
  if (!Number.isInteger(noticeId)) {
    return c.json({ message: "올바른 공지 요청이 아닙니다." }, 400);
  }

  const body = noticeSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ message: "공지 제목과 내용을 다시 확인해 주세요." }, 400);
  }

  const updatedOk = await updateNotice(c.env.DB, {
    noticeId,
    title: body.data.title,
    content: body.data.content,
  });

  if (!updatedOk) {
    return c.json({ message: "공지사항을 찾을 수 없습니다." }, 404);
  }

  const notice = await getNoticeById(c.env.DB, noticeId);
  return c.json({ item: notice ?? null });
});

app.delete("/api/notices/:noticeId", authGuard(["ADMIN", "DIRECTOR"]), async (c) => {
  const noticeId = Number(c.req.param("noticeId"));
  if (!Number.isInteger(noticeId)) {
    return c.json({ message: "올바른 공지 요청이 아닙니다." }, 400);
  }

  const deletedOk = await deleteNotice(c.env.DB, noticeId);
  if (!deletedOk) {
    return c.json({ message: "공지사항을 찾을 수 없습니다." }, 404);
  }

  return c.json({ ok: true });
});

app.get("/api/admin/employees", authGuard(["ADMIN", "DIRECTOR"]), async (c) => {
  const [items, orgUnits] = await Promise.all([listEmployeesForManagement(c.env.DB), listOrgUnits(c.env.DB)]);
  return c.json({ items, orgUnits });
});

app.get("/api/admin/employees/export", authGuard(["ADMIN", "DIRECTOR"]), async (c) => {
  const employees = await listEmployeesForManagement(c.env.DB);
  const items = await Promise.all(
    employees.map(async (employee) => {
      const cycle = calculateLeaveCycle(employee.joinedAt);
      const rows = await listCycleLeaveRows(c.env.DB, employee.id, cycle.cycleStart, cycle.cycleEnd);
      const summary = buildLeaveSummary(employee.joinedAt, employee.role, employee.leaderId !== null, rows);

      return {
        employeeNo: employee.employeeNo,
        name: employee.name,
        joinedAt: employee.joinedAt,
        entitlement: summary.entitlement,
        used: summary.used,
        remaining: summary.remaining,
      };
    }),
  );

  return c.json({ items });
});

app.post("/api/admin/employees", authGuard(["ADMIN", "DIRECTOR"]), async (c) => {
  const body = employeeCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ message: "직원 등록 값을 다시 확인해 주세요." }, 400);
  }

  if (body.data.leaderId !== null) {
    const leader = await getEmployeeById(c.env.DB, body.data.leaderId);
    if (!leader || leader.is_active !== 1) {
      return c.json({ message: "승인자 정보를 찾을 수 없습니다." }, 400);
    }

    if (leader.role === "USER") {
      return c.json({ message: "일반 직원은 승인자로 지정할 수 없습니다." }, 400);
    }
  }

  if (body.data.orgUnitId !== null) {
    const orgUnit = await getOrgUnitById(c.env.DB, body.data.orgUnitId);
    if (!orgUnit) {
      return c.json({ message: "소속 정보를 찾을 수 없습니다." }, 400);
    }
  }

  const [existingEmployeeNo, existingEmail] = await Promise.all([
    getEmployeeByEmployeeNo(c.env.DB, body.data.employeeNo),
    getEmployeeByEmail(c.env.DB, body.data.email),
  ]);

  if (existingEmployeeNo) {
    return c.json({ message: "이미 사용 중인 사번입니다." }, 409);
  }

  if (existingEmail) {
    return c.json({ message: "이미 사용 중인 이메일입니다." }, 409);
  }

  const passwordHash = await hashPassword(body.data.password);
  const retiredAt = body.data.isActive ? null : new Date().toISOString().slice(0, 10);
  const employeeId = await createEmployeeForManagement(c.env.DB, {
    employeeNo: body.data.employeeNo,
    name: body.data.name,
    email: body.data.email,
    passwordHash,
    joinedAt: body.data.joinedAt,
    role: body.data.role,
    orgUnitId: body.data.orgUnitId,
    leaderId: body.data.leaderId,
    isActive: body.data.isActive,
    retiredAt,
  });

  const item = await getManagedEmployeeById(c.env.DB, employeeId);
  return c.json({ item }, 201);
});

app.patch("/api/admin/employees/:employeeId", authGuard(["ADMIN", "DIRECTOR"]), async (c) => {
  const actor = c.get("employee");
  const employeeId = Number(c.req.param("employeeId"));
  if (!Number.isInteger(employeeId)) {
    return c.json({ message: "직원 식별자가 올바르지 않습니다." }, 400);
  }

  const body = employeeUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ message: "직원 수정 값을 다시 확인해 주세요." }, 400);
  }

  if (body.data.leaderId === employeeId) {
    return c.json({ message: "본인을 승인자로 지정할 수 없습니다." }, 400);
  }

  if (!body.data.isActive && actor.id === employeeId) {
    return c.json({ message: "현재 로그인한 계정은 퇴사 처리할 수 없습니다." }, 400);
  }

  if (body.data.retiredAt && body.data.retiredAt < body.data.joinedAt) {
    return c.json({ message: "퇴사일은 입사일보다 빠를 수 없습니다." }, 400);
  }

  if (body.data.orgUnitId !== null) {
    const orgUnit = await getOrgUnitById(c.env.DB, body.data.orgUnitId);
    if (!orgUnit) {
      return c.json({ message: "소속 정보를 찾을 수 없습니다." }, 400);
    }
  }

  if (body.data.leaderId !== null) {
    const leader = await getEmployeeById(c.env.DB, body.data.leaderId);
    if (!leader || leader.is_active !== 1) {
      return c.json({ message: "승인자 정보를 찾을 수 없습니다." }, 400);
    }

    if (leader.role === "USER") {
      return c.json({ message: "일반 직원은 승인자로 지정할 수 없습니다." }, 400);
    }
  }

  const normalizedRetiredAt = body.data.isActive ? null : body.data.retiredAt ?? new Date().toISOString().slice(0, 10);
  const updatedOk = await updateEmployeeForManagement(c.env.DB, {
    employeeId,
    joinedAt: body.data.joinedAt,
    retiredAt: normalizedRetiredAt,
    orgUnitId: body.data.orgUnitId,
    leaderId: body.data.leaderId,
    isActive: body.data.isActive,
  });

  if (!updatedOk) {
    return c.json({ message: "직원 정보를 찾을 수 없습니다." }, 404);
  }

  const item = await getManagedEmployeeById(c.env.DB, employeeId);
  return c.json({ item });
});

app.get("/api/leave/balance/:employeeId", authGuard(), async (c) => {
  const actor = c.get("employee");
  const employeeId = Number(c.req.param("employeeId"));
  if (!Number.isInteger(employeeId)) {
    return c.json({ message: "올바른 직원 요청이 아닙니다." }, 400);
  }

  if (actor.id !== employeeId && !["HR", "ADMIN", "DIRECTOR"].includes(actor.role)) {
    return c.json({ message: "본인 연차만 조회할 수 있습니다." }, 403);
  }

  const employee = actor.id === employeeId ? actor : await getEmployeeById(c.env.DB, employeeId);
  if (!employee) {
    return c.json({ message: "직원 정보를 찾을 수 없습니다." }, 404);
  }

  const cycle = calculateLeaveCycle(employee.joined_at);
  const rows = await listCycleLeaveRows(c.env.DB, employeeId, cycle.cycleStart, cycle.cycleEnd);
  return c.json(buildLeaveSummary(employee.joined_at, employee.role, employee.leader_id !== null, rows));
});

app.get("/api/leave/history", authGuard(), async (c) => {
  const actor = c.get("employee");
  const items = await listHistoryVisibleToActor(c.env.DB, actor);
  return c.json({ items });
});

app.get("/api/approvals/pending", authGuard(["LEADER", "HR", "ADMIN", "DIRECTOR"]), async (c) => {
  const actor = c.get("employee");
  const items = await listPendingApprovalsForActor(c.env.DB, actor);
  return c.json({ items });
});

app.post("/api/leave/request", authGuard(), async (c) => {
  const employee = c.get("employee");
  const body = requestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ message: "휴가 요청 값을 다시 확인해 주세요." }, 400);
  }

  if (body.data.startDate > body.data.endDate) {
    return c.json({ message: "종료일은 시작일보다 빠를 수 없습니다." }, 400);
  }

  if ((body.data.type === "HALF_AM" || body.data.type === "HALF_PM") && body.data.startDate !== body.data.endDate) {
    return c.json({ message: "반차는 하루 단위로만 신청할 수 있습니다." }, 400);
  }

  const amount = calculateRequestAmount(body.data.type, body.data.startDate, body.data.endDate);
  let cycle: ReturnType<typeof calculateLeaveCycle> | null = null;

  if (consumesAnnualBalance(body.data.type)) {
    cycle = calculateLeaveCycle(employee.joined_at);
    const rows = await listCycleLeaveRows(c.env.DB, employee.id, cycle.cycleStart, cycle.cycleEnd);
    const summary = buildLeaveSummary(employee.joined_at, employee.role, employee.leader_id !== null, rows);
    if (summary.remaining < amount) {
      return c.json({ message: "잔여 연차가 부족합니다." }, 400);
    }
  }

  const requestId = await insertLeaveRequest(c.env.DB, {
    employeeId: employee.id,
    type: body.data.type,
    startDate: body.data.startDate,
    endDate: body.data.endDate,
    amount,
    reason: body.data.reason,
    actorId: employee.id,
    cycleStart: cycle?.cycleStart,
    cycleEnd: cycle?.cycleEnd,
    entitlement: cycle?.entitlement,
  });

  if (!requestId) {
    return c.json({ message: "다른 요청이 먼저 반영되어 잔여 연차가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, 409);
  }

  const row = await getLeaveRequestRowById(c.env.DB, requestId);
  return c.json({ item: row ? toLeaveItem(row) : null }, 201);
});

function ensureActorMatchesStage(actor: EmployeeRecord, owner: EmployeeRecord, requestId: number, stage: ReturnType<typeof getNextPendingStage>) {
  if (!stage) {
    return { ok: false, message: "이미 최종 처리된 요청입니다." };
  }

  if (actor.role === "ADMIN" || actor.role === "DIRECTOR") {
    return { ok: true, requestId, isSuperPassOverride: true };
  }

  if (stage === "LEADER") {
    if (actor.role !== "LEADER") {
      return { ok: false, message: "팀장 승인 단계의 요청입니다." };
    }

    if (owner.id === actor.id) {
      return { ok: false, message: "본인 신청은 직접 승인할 수 없습니다." };
    }

    if (owner.leader_id !== actor.id) {
      return { ok: false, message: "해당 팀장만 이 요청을 승인할 수 있습니다." };
    }
  }

  if (stage === "HR" && actor.role !== "HR") {
    return { ok: false, message: "인사 승인 단계의 요청입니다." };
  }

  if (stage === "DIRECTOR") {
    return { ok: false, message: "원장 승인 단계의 요청입니다." };
  }

  return { ok: true, requestId };
}

app.patch("/api/leave/approve", authGuard(["LEADER", "HR", "ADMIN", "DIRECTOR"]), async (c) => {
  const actor = c.get("employee");
  const body = approvalSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ message: "결재 요청 형식이 올바르지 않습니다." }, 400);
  }

  const row = await getLeaveRequestRowById(c.env.DB, body.data.requestId);
  if (!row) {
    return c.json({ message: "휴가 요청을 찾을 수 없습니다." }, 404);
  }

  const requestOwner = await getEmployeeById(c.env.DB, row.emp_id);
  if (!requestOwner) {
    return c.json({ message: "요청자 정보를 찾을 수 없습니다." }, 404);
  }

  const currentStage = getNextPendingStage(requestOwner.role, requestOwner.leader_id !== null, row.status);
  const stageCheck = ensureActorMatchesStage(actor, requestOwner, body.data.requestId, currentStage);
  if (!stageCheck.ok) {
    return c.json({ message: stageCheck.message }, 403);
  }

  let nextStatus: LeaveStatus = "REJECTED";
  let leaderId: number | null = null;
  let hrId: number | null = null;
  let directorId: number | null = null;
  const isSuperPassOverride = (actor.role === "ADMIN" || actor.role === "DIRECTOR") && stageCheck.isSuperPassOverride === true;

  if (currentStage === "LEADER") {
    leaderId = actor.id;
  } else if (currentStage === "HR") {
    hrId = actor.id;
  } else if (currentStage === "DIRECTOR") {
    directorId = actor.id;
  }

  if (body.data.action === "APPROVE") {
    if (isSuperPassOverride) {
      const approvalStages = getApprovalStages(requestOwner.role, requestOwner.leader_id !== null);
      const finalStage = approvalStages[approvalStages.length - 1];
      nextStatus = getStatusAfterStage(finalStage);

      if (finalStage === "HR") {
        hrId = actor.id;
        directorId = null;
      } else if (finalStage === "DIRECTOR") {
        directorId = actor.id;
      }
    } else {
      nextStatus = getStatusAfterStage(currentStage!);
    }
  }

  const updatedOk = await updateLeaveRequestStatus(c.env.DB, {
    requestId: body.data.requestId,
    currentStatus: row.status,
    status: nextStatus,
    leaderId,
    hrId,
    directorId,
    actorId: actor.id,
    eventAction: body.data.action === "APPROVE" ? "REQUEST_APPROVED" : "REQUEST_REJECTED",
    note: body.data.note ?? (isSuperPassOverride && body.data.action === "APPROVE" ? "전결 승인" : undefined),
  });

  if (!updatedOk) {
    return c.json({ message: "다른 사용자가 먼저 처리한 요청입니다. 새로고침 후 다시 확인해 주세요." }, 409);
  }

  const updated = await getLeaveRequestRowById(c.env.DB, body.data.requestId);
  return c.json({ item: updated ? toLeaveItem(updated) : null });
});

app.notFound((c) => c.json({ message: "요청한 API를 찾을 수 없습니다." }, 404));

app.onError((error, c) => {
  console.error(error);
  return c.json({ message: "서버 처리 중 오류가 발생했습니다." }, 500);
});

export const onRequest = handle(app);
