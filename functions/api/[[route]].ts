import { Hono } from "hono";
import { z } from "zod";
import { getApprovalStages, getNextPendingStage, getStatusAfterStage } from "../../src/lib/approval-flow";
import { authGuard, clearSession, createLunchSsoToken, hashPassword, serializeEmployee, setSession, verifyPassword } from "../lib/auth";
import {
  countActiveDirectReports,
  createEmployeeForManagement,
  deleteNotice,
  getEmployeeByEmployeeNo,
  getEmployeeByEmail,
  getEmployeeById,
  getManagedEmployeeById,
  getOrgUnitById,
  getLeaveRequestRowById,
  getNoticeById,
  insertEmployeeLeaveAdjustmentLog,
  insertLeaveRequest,
  insertNotice,
  listEmployeeLeaveRows,
  listEmployeesForManagement,
  listHistoryVisibleToActor,
  listNotices,
  listOrgUnits,
  listPendingApprovalsForActor,
  toLeaveItem,
  updateEmployeeForManagement,
  updateEmployeePasswordHash,
  updateLeaveRequestStatus,
  updateNotice,
  type EmployeeRecord,
  type LeaveStatus,
} from "../lib/db";
import {
  buildLeaveSummary,
  calculateRequestAmount,
  consumesAnnualBalance,
  convertCumulativeAdjustmentToCycleAdjustment,
  formatDbTimestamp,
  resolveCumulativeLeaveAdjustment,
} from "../lib/leave";
import { getDiceRanking, getDiceStatus, grantDiceBonus, rerollDice, rollDice } from "../lib/dice";
import type { LeaveSummary } from "../../src/types";
import { handle } from "hono/cloudflare-pages";

type AppEnv = {
  Bindings: {
    DB: D1Database;
    FILES: R2Bucket;
    JWT_SECRET: string;
    SESSION_COOKIE_NAME?: string;
    SESSION_COOKIE_DOMAIN?: string;
    LUNCH_APP_URL?: string;
    LUNCH_APP_ENABLED?: string;
    LUNCH_SSO_SECRET?: string;
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
  type: z.enum(["ANNUAL", "HALF_AM", "HALF_PM", "SICK", "UNPAID"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(2).max(500),
});

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(8).max(100),
    newPassword: z.string().min(8).max(100),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "새 비밀번호를 현재 비밀번호와 다르게 입력해 주세요.",
    path: ["newPassword"],
  });

const approvalSchema = z.object({
  requestId: z.number().int().positive(),
  action: z.enum(["APPROVE", "REJECT", "CANCEL"]),
  note: z.string().trim().max(500).optional(),
});

const noticeSchema = z.object({
  title: z.string().trim().min(2).max(80),
  content: z.string().trim().min(2).max(1000),
});

const diceGrantSchema = z.object({
  employeeNo: z.string().trim().min(4).max(32),
  reason: z.string().trim().min(2).max(120).default("원스텝 참여 보너스"),
});

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const diceRerollSchema = z
  .object({
    rollDate: z.string().regex(datePattern).optional(),
  })
  .optional();
const isHalfDayStep = (value: number) => Number.isFinite(value) && Math.abs(value * 2 - Math.round(value * 2)) < 1e-9;
const roundLeaveDays = (value: number) => Number(value.toFixed(1));
const enabledFlag = (value?: string) => ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());

const employeeUpdateSchema = z.object({
  joinedAt: z.string().regex(datePattern),
  retiredAt: z.union([z.string().regex(datePattern), z.null()]),
  role: z.enum(["USER", "LEADER", "HR", "ADMIN", "DIRECTOR"]),
  orgUnitId: z.number().int().positive().nullable(),
  leaderId: z.number().int().positive().nullable(),
  leaveAdjustmentDays: z.number().finite().refine(isHalfDayStep, {
    message: "연차 조정값은 0.5일 단위로 입력해 주세요.",
  }),
  targetRemainingDays: z.number().finite().min(0).refine(isHalfDayStep, {
    message: "최종 잔여연차는 0.5일 단위로 입력해 주세요.",
  }).optional(),
  adjustmentReason: z.string().trim().min(2).max(200).optional(),
  isActive: z.boolean(),
  password: z.string().trim().min(8).max(100).optional(),
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

export const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

app.get("/api/health", (c) => c.json({ ok: true, date: "2026-04-16" }));

app.get("/api/config", (c) =>
  c.json({
    lunchAppUrl: c.env.LUNCH_APP_URL?.trim() || "",
    lunchAppEnabled: enabledFlag(c.env.LUNCH_APP_ENABLED),
  }),
);

app.get("/api/lunch/sso-link", authGuard(), async (c) => {
  const lunchAppUrl = c.env.LUNCH_APP_URL?.trim();
  if (!lunchAppUrl) {
    return c.json({ message: "도시락 앱 주소가 설정되지 않았습니다." }, 500);
  }

  const target = new URL(lunchAppUrl);
  target.searchParams.set("sso_token", await createLunchSsoToken(c.env, c.get("employee")));
  return c.redirect(target.toString(), 302);
});

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

app.patch("/api/auth/password", authGuard(), async (c) => {
  const actor = c.get("employee");
  const body = passwordChangeSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ message: body.error.issues[0]?.message ?? "비밀번호를 다시 확인해 주세요." }, 400);
  }

  const currentPasswordOk = await verifyPassword(body.data.currentPassword, actor.password_hash);
  if (!currentPasswordOk) {
    return c.json({ message: "현재 비밀번호가 올바르지 않습니다." }, 401);
  }

  const newPasswordHash = await hashPassword(body.data.newPassword);
  const updatedOk = await updateEmployeePasswordHash(c.env.DB, actor.id, newPasswordHash);
  if (!updatedOk) {
    return c.json({ message: "비밀번호를 변경하지 못했습니다." }, 500);
  }

  return c.json({ ok: true });
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

type ManagedEmployee = Awaited<ReturnType<typeof listEmployeesForManagement>>[number];

function toClientLeaveSummary(summary: LeaveSummary): LeaveSummary {
  return {
    ...summary,
    used: roundLeaveDays(summary.entitlement - summary.pending - summary.remaining),
  };
}

async function attachLeaveSummaryToEmployee(db: D1Database, employee: ManagedEmployee) {
  const rows = await listEmployeeLeaveRows(db, employee.id);
  const effectiveAdjustmentDays = resolveCumulativeLeaveAdjustment(
    employee.joinedAt,
    employee.role,
    employee.leaderId !== null,
    rows,
    employee.leaveAdjustmentDays,
    employee.leaveAdjustmentCycleStart ?? employee.updatedAt,
  );
  const summary = buildLeaveSummary(employee.joinedAt, employee.role, employee.leaderId !== null, rows, effectiveAdjustmentDays);

  return {
    ...employee,
    leaveAdjustmentDays: effectiveAdjustmentDays,
    leaveEntitlementDays: summary.entitlement,
    usedLeaveDays: summary.used,
    pendingLeaveDays: summary.pending,
    remainingLeaveDays: summary.remaining,
    leaveBaseRemainingDays: roundLeaveDays(summary.entitlement - summary.used - summary.pending),
  };
}

async function attachLeaveSummariesToEmployees(db: D1Database, employees: ManagedEmployee[]) {
  return Promise.all(employees.map((employee) => attachLeaveSummaryToEmployee(db, employee)));
}

app.get("/api/admin/employees", authGuard(["ADMIN", "DIRECTOR"]), async (c) => {
  const [employees, orgUnits] = await Promise.all([listEmployeesForManagement(c.env.DB), listOrgUnits(c.env.DB)]);
  const items = await attachLeaveSummariesToEmployees(c.env.DB, employees);
  return c.json({ items, orgUnits });
});

app.get("/api/admin/employees/export", authGuard(["ADMIN", "DIRECTOR"]), async (c) => {
  const employees = await listEmployeesForManagement(c.env.DB);
  const items = await Promise.all(
    employees.map(async (employee) => {
      const rows = await listEmployeeLeaveRows(c.env.DB, employee.id);
      const effectiveAdjustmentDays = resolveCumulativeLeaveAdjustment(
        employee.joinedAt,
        employee.role,
        employee.leaderId !== null,
        rows,
        employee.leaveAdjustmentDays,
        employee.leaveAdjustmentCycleStart ?? employee.updatedAt,
      );
      const summary = buildLeaveSummary(employee.joinedAt, employee.role, employee.leaderId !== null, rows, effectiveAdjustmentDays);

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
  return c.json({ item: item ? await attachLeaveSummaryToEmployee(c.env.DB, item) : null }, 201);
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

  const currentEmployee = await getEmployeeById(c.env.DB, employeeId);
  if (!currentEmployee) {
    return c.json({ message: "직원 정보를 찾을 수 없습니다." }, 404);
  }

  if (actor.id === employeeId && body.data.role !== currentEmployee.role) {
    return c.json({ message: "본인 계정의 직급은 변경할 수 없습니다." }, 400);
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

  if (body.data.role === "USER") {
    const activeDirectReports = await countActiveDirectReports(c.env.DB, employeeId);
    if (activeDirectReports > 0) {
      return c.json({ message: "현재 팀원들이 이 직원을 승인자로 사용 중이라 일반 직원으로 내릴 수 없습니다. 먼저 팀원들의 승인자를 다시 지정해 주세요." }, 409);
    }
  }

  const adjustmentAnchorAt = formatDbTimestamp(new Date());
  const adjustmentAnchorDate = new Date(`${adjustmentAnchorAt.replace(" ", "T")}Z`);
  const rows = await listEmployeeLeaveRows(c.env.DB, employeeId);
  let nextEffectiveAdjustmentDays = body.data.leaveAdjustmentDays;
  if (body.data.targetRemainingDays !== undefined) {
    const summary = buildLeaveSummary(body.data.joinedAt, body.data.role, body.data.leaderId !== null, rows, 0);
    nextEffectiveAdjustmentDays = roundLeaveDays(body.data.targetRemainingDays - (summary.entitlement - summary.used - summary.pending));
  }

  const currentEffectiveAdjustmentDays = resolveCumulativeLeaveAdjustment(
    currentEmployee.joined_at,
    currentEmployee.role,
    currentEmployee.leader_id !== null,
    rows,
    currentEmployee.leave_adjustment_days ?? 0,
    currentEmployee.leave_adjustment_cycle_start ?? currentEmployee.updated_at,
  );
  const adjustmentChanged = currentEffectiveAdjustmentDays !== nextEffectiveAdjustmentDays;
  if (adjustmentChanged && !body.data.adjustmentReason?.trim()) {
    return c.json({ message: "연차 조정값을 변경할 때는 사유를 함께 입력해 주세요." }, 400);
  }

  const nextStoredAdjustmentDays = adjustmentChanged
    ? convertCumulativeAdjustmentToCycleAdjustment(
        body.data.joinedAt,
        body.data.role,
        body.data.leaderId !== null,
        rows,
        nextEffectiveAdjustmentDays,
        adjustmentAnchorDate,
      )
    : currentEmployee.leave_adjustment_days ?? 0;
  const nextAdjustmentAnchorAt = adjustmentChanged
    ? adjustmentAnchorAt
    : currentEmployee.leave_adjustment_cycle_start ?? currentEmployee.updated_at ?? null;

  let passwordHash: string | null = null;
  if (body.data.password) {
    passwordHash = await hashPassword(body.data.password);
  }

  const normalizedRetiredAt = body.data.isActive ? null : body.data.retiredAt ?? new Date().toISOString().slice(0, 10);
  const updatedOk = await updateEmployeeForManagement(c.env.DB, {
    employeeId,
    joinedAt: body.data.joinedAt,
    retiredAt: normalizedRetiredAt,
    role: body.data.role,
    orgUnitId: body.data.orgUnitId,
    leaderId: body.data.leaderId,
    leaveAdjustmentDays: nextStoredAdjustmentDays,
    leaveAdjustmentCycleStart: nextAdjustmentAnchorAt,
    isActive: body.data.isActive,
    passwordHash,
  });

  if (!updatedOk) {
    return c.json({ message: "직원 정보를 찾을 수 없습니다." }, 404);
  }

  if (adjustmentChanged) {
    await insertEmployeeLeaveAdjustmentLog(c.env.DB, {
      employeeId,
      actorId: actor.id,
      previousAdjustmentDays: currentEffectiveAdjustmentDays,
      newAdjustmentDays: nextEffectiveAdjustmentDays,
      reason: body.data.adjustmentReason?.trim() ?? "",
    });
  }

  const item = await getManagedEmployeeById(c.env.DB, employeeId);
  return c.json({ item: item ? await attachLeaveSummaryToEmployee(c.env.DB, item) : null });
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

  const rows = await listEmployeeLeaveRows(c.env.DB, employeeId);
  const effectiveAdjustmentDays = resolveCumulativeLeaveAdjustment(
    employee.joined_at,
    employee.role,
    employee.leader_id !== null,
    rows,
    employee.leave_adjustment_days ?? 0,
    employee.leave_adjustment_cycle_start ?? employee.updated_at,
  );
  return c.json(toClientLeaveSummary(buildLeaveSummary(employee.joined_at, employee.role, employee.leader_id !== null, rows, effectiveAdjustmentDays)));
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
  let balanceStart: string | undefined;
  let balanceEnd: string | undefined;
  let entitlementForRequest: number | undefined;

  if (consumesAnnualBalance(body.data.type)) {
    const rows = await listEmployeeLeaveRows(c.env.DB, employee.id);
    const effectiveAdjustmentDays = resolveCumulativeLeaveAdjustment(
      employee.joined_at,
      employee.role,
      employee.leader_id !== null,
      rows,
      employee.leave_adjustment_days ?? 0,
      employee.leave_adjustment_cycle_start ?? employee.updated_at,
    );
    const summary = buildLeaveSummary(employee.joined_at, employee.role, employee.leader_id !== null, rows, effectiveAdjustmentDays);
    entitlementForRequest = summary.entitlement + effectiveAdjustmentDays;
    balanceStart = employee.joined_at;
    balanceEnd = "9999-12-31";
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
    requesterRole: employee.role,
    requesterHasLeader: employee.leader_id !== null ? 1 : 0,
    requesterLeaderId: employee.leader_id,
    cycleStart: balanceStart,
    cycleEnd: balanceEnd,
    entitlement: entitlementForRequest,
  });

  if (!requestId) {
    return c.json({ message: "다른 요청이 먼저 반영되어 잔여 연차가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, 409);
  }

  const row = await getLeaveRequestRowById(c.env.DB, requestId);
  return c.json({ item: row ? toLeaveItem(row) : null }, 201);
});

function ensureActorMatchesStage(actor: EmployeeRecord, ownerEmpId: number, requesterLeaderId: number | null, requestId: number, stage: ReturnType<typeof getNextPendingStage>) {
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

    if (ownerEmpId === actor.id) {
      return { ok: false, message: "본인 신청은 직접 승인할 수 없습니다." };
    }

    if (requesterLeaderId !== actor.id) {
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

function getFinalApproverId(row: NonNullable<Awaited<ReturnType<typeof getLeaveRequestRowById>>>) {
  return row.approved_director_id ?? row.approved_hr_id ?? row.approved_leader_id ?? null;
}

app.patch("/api/leave/approve", authGuard(), async (c) => {
  const actor = c.get("employee");
  const body = approvalSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ message: "결재 요청 형식이 올바르지 않습니다." }, 400);
  }

  const row = await getLeaveRequestRowById(c.env.DB, body.data.requestId);
  if (!row) {
    return c.json({ message: "휴가 요청을 찾을 수 없습니다." }, 404);
  }

  const requesterRole = row.requester_role;
  const requesterHasLeader = row.requester_has_leader === 1;

  if (body.data.action === "CANCEL") {
    if (row.status === "PENDING") {
      if (row.emp_id !== actor.id) {
        return c.json({ message: "신청자 본인만 1차 결재 전 요청을 취소할 수 있습니다." }, 403);
      }

      const requesterCancelledOk = await updateLeaveRequestStatus(c.env.DB, {
        requestId: body.data.requestId,
        currentStatus: row.status,
        status: "CANCELLED",
        actorId: actor.id,
        eventAction: "REQUEST_CANCELLED",
        note: body.data.note ?? "신청자 취소",
      });

      if (!requesterCancelledOk) {
        return c.json({ message: "다른 사용자가 먼저 처리한 요청입니다. 새로고침 후 다시 확인해 주세요." }, 409);
      }

      const requesterCancelled = await getLeaveRequestRowById(c.env.DB, body.data.requestId);
      return c.json({ item: requesterCancelled ? toLeaveItem(requesterCancelled) : null });
    }

    const isFinalized =
      row.status !== "REJECTED" &&
      row.status !== "CANCELLED" &&
      getNextPendingStage(requesterRole, requesterHasLeader, row.status) === null;

    if (!isFinalized) {
      return c.json({ message: "최종 승인된 건만 취소할 수 있습니다." }, 400);
    }

    const finalApproverId = getFinalApproverId(row);
    const canPrivilegedRoleCancel = actor.role === "ADMIN" || actor.role === "HR";
    if (!canPrivilegedRoleCancel && finalApproverId !== actor.id) {
      return c.json({ message: "마지막 결재자만 승인 취소를 할 수 있습니다." }, 403);
    }

    const cancelledOk = await updateLeaveRequestStatus(c.env.DB, {
      requestId: body.data.requestId,
      currentStatus: row.status,
      status: "CANCELLED",
      actorId: actor.id,
      eventAction: "REQUEST_CANCELLED",
      note: body.data.note ?? "최종 승인 취소",
    });

    if (!cancelledOk) {
      return c.json({ message: "다른 사용자가 먼저 처리한 요청입니다. 새로고침 후 다시 확인해 주세요." }, 409);
    }

    const cancelled = await getLeaveRequestRowById(c.env.DB, body.data.requestId);
    return c.json({ item: cancelled ? toLeaveItem(cancelled) : null });
  }

  const currentStage = getNextPendingStage(requesterRole, requesterHasLeader, row.status);
  const stageCheck = ensureActorMatchesStage(actor, row.emp_id, row.requester_leader_id, body.data.requestId, currentStage);
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
      const approvalStages = getApprovalStages(requesterRole, requesterHasLeader);
      const finalStage = approvalStages[approvalStages.length - 1];
      nextStatus = getStatusAfterStage(finalStage);

      if (finalStage === "HR") {
        leaderId = null;
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

app.get("/api/dice/status", authGuard(), async (c) => {
  const actor = c.get("employee");
  const status = await getDiceStatus(c.env.DB, actor.employee_no);
  return c.json(status);
});

app.post("/api/dice/roll", authGuard(), async (c) => {
  const actor = c.get("employee");
  const result = await rollDice(c.env.DB, actor.employee_no);
  if (!result.ok) {
    return c.json({ message: result.message }, 409);
  }

  const [status, ranking] = await Promise.all([getDiceStatus(c.env.DB, actor.employee_no), getDiceRanking(c.env.DB, actor.employee_no)]);
  return c.json({ roll: result.roll, status, ranking }, 201);
});

app.post("/api/dice/reroll", authGuard(), async (c) => {
  const actor = c.get("employee");
  const body = diceRerollSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!body.success) {
    return c.json({ message: "리롤 날짜 정보를 다시 확인해 주세요." }, 400);
  }

  const result = await rerollDice(c.env.DB, actor.employee_no, body.data?.rollDate);
  if (!result.ok) {
    return c.json({ message: result.message }, 409);
  }

  const [status, ranking] = await Promise.all([getDiceStatus(c.env.DB, actor.employee_no), getDiceRanking(c.env.DB, actor.employee_no)]);
  return c.json({ roll: result.roll, status, ranking }, 201);
});

app.get("/api/dice/ranking", authGuard(), async (c) => {
  const actor = c.get("employee");
  const ranking = await getDiceRanking(c.env.DB, actor.employee_no);
  return c.json(ranking);
});

app.post("/api/admin/dice/grant", authGuard(["ADMIN", "DIRECTOR"]), async (c) => {
  const actor = c.get("employee");
  const body = diceGrantSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ message: "보너스 지급 정보를 다시 확인해 주세요." }, 400);
  }

  const result = await grantDiceBonus(c.env.DB, body.data.employeeNo, body.data.reason, actor);
  if (!result.ok) {
    return c.json({ message: result.message }, 400);
  }

  return c.json({ ok: true, id: result.id }, 201);
});

app.notFound((c) => c.json({ message: "요청한 API를 찾을 수 없습니다." }, 404));

app.onError((error, c) => {
  console.error(error);
  return c.json({ message: "서버 처리 중 오류가 발생했습니다." }, 500);
});

export const onRequest = handle(app);
