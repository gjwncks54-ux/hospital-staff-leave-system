import { Hono } from "hono";
import { z } from "zod";
import { getNextPendingStage, getStatusAfterStage } from "../../src/lib/approval-flow";
import { authGuard, clearSession, serializeEmployee, setSession, verifyPassword } from "../lib/auth";
import {
  getEmployeeByEmployeeNo,
  getEmployeeById,
  getLeaveRequestRowById,
  getNoticeById,
  insertLeaveRequest,
  insertNotice,
  listCycleLeaveRows,
  listHistoryVisibleToActor,
  listNotices,
  listPendingApprovalsForActor,
  toLeaveItem,
  updateLeaveRequestStatus,
  type EmployeeRecord,
  type LeaveStatus,
  type LeaveType,
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
      return c.json({ message: "사번과 비밀번호를 다시 확인해주세요." }, 400);
    }

    const employee = await getEmployeeByEmployeeNo(c.env.DB, body.data.employeeNo);
    if (!employee || employee.is_active !== 1) {
      return c.json({ message: "등록되지 않은 계정입니다." }, 401);
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

app.post("/api/notices", authGuard(["LEADER", "HR", "ADMIN", "DIRECTOR"]), async (c) => {
  const actor = c.get("employee");
  const body = noticeSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ message: "공지 제목과 내용을 다시 확인해주세요." }, 400);
  }

  const noticeId = await insertNotice(c.env.DB, {
    title: body.data.title,
    content: body.data.content,
    authorId: actor.id,
  });

  const notice = await getNoticeById(c.env.DB, noticeId);
  return c.json({ item: notice ?? null }, 201);
});

app.get("/api/leave/balance/:employeeId", authGuard(), async (c) => {
  const actor = c.get("employee");
  const employeeId = Number(c.req.param("employeeId"));
  if (!Number.isInteger(employeeId)) {
    return c.json({ message: "잘못된 사번 요청입니다." }, 400);
  }

  if (actor.id !== employeeId && !["HR", "ADMIN", "DIRECTOR"].includes(actor.role)) {
    return c.json({ message: "본인 잔여 연차만 조회할 수 있습니다." }, 403);
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
    return c.json({ message: "휴가 신청 값을 다시 확인해주세요." }, 400);
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
    return { ok: false, message: "이미 최종 처리된 신청입니다." };
  }

  if (stage === "LEADER") {
    if (actor.role !== "LEADER") {
      return { ok: false, message: "팀장 승인 단계의 신청입니다." };
    }

    if (owner.id === actor.id) {
      return { ok: false, message: "본인 신청은 직접 승인할 수 없습니다." };
    }

    if (owner.leader_id !== actor.id) {
      return { ok: false, message: "담당 팀장만 이 신청을 승인할 수 있습니다." };
    }
  }

  if (stage === "HR" && !["HR", "ADMIN"].includes(actor.role)) {
    return { ok: false, message: "인사 승인 단계의 신청입니다." };
  }

  if (stage === "DIRECTOR" && actor.role !== "DIRECTOR") {
    return { ok: false, message: "원장 승인 단계의 신청입니다." };
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
    return c.json({ message: "휴가 신청을 찾을 수 없습니다." }, 404);
  }

  const requestOwner = await getEmployeeById(c.env.DB, row.emp_id);
  if (!requestOwner) {
    return c.json({ message: "신청자 정보를 찾을 수 없습니다." }, 404);
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

  if (currentStage === "LEADER") {
    leaderId = actor.id;
  } else if (currentStage === "HR") {
    hrId = actor.id;
  } else if (currentStage === "DIRECTOR") {
    directorId = actor.id;
  }

  if (body.data.action === "APPROVE") {
    nextStatus = getStatusAfterStage(currentStage!);
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
    note: body.data.note,
  });

  if (!updatedOk) {
    return c.json({ message: "다른 사용자가 이미 처리한 요청입니다. 새로고침 후 다시 확인해 주세요." }, 409);
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
