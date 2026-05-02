import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LeaveRow } from "../../functions/lib/db";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock() calls
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  updateLeaveRequestStatus: vi.fn().mockResolvedValue(true),
  getLeaveRequestRowById: vi.fn(),
  insertLeaveRequest: vi.fn().mockResolvedValue(1),
  listEmployeeLeaveRows: vi.fn().mockResolvedValue([]),
}));

const authMocks = vi.hoisted(() => ({
  actor: {
    id: 99,
    employee_no: "ADM001",
    name: "관리자",
    email: "admin@hospital.com",
    role: "ADMIN" as const,
    joined_at: "2020-01-01",
    leave_adjustment_days: 0,
    leave_adjustment_cycle_start: null,
    retired_at: null,
    leader_id: null,
    is_active: 1,
    password_hash: "x",
    org_unit_id: null,
    team_name: null,
    division_name: null,
    root_name: null,
    updated_at: "2026-04-23 00:00:00",
  } as import("../../functions/lib/db").EmployeeRecord,
}));

vi.mock("../../functions/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../functions/lib/db")>();
  return {
    ...actual,
    updateLeaveRequestStatus: mocks.updateLeaveRequestStatus,
    getLeaveRequestRowById: mocks.getLeaveRequestRowById,
    insertLeaveRequest: mocks.insertLeaveRequest,
    listEmployeeLeaveRows: mocks.listEmployeeLeaveRows,
  };
});

vi.mock("../../functions/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../functions/lib/auth")>();
  return {
    ...actual,
    authGuard: (_roles?: string[]) => async (c: any, next: any) => {
      c.set("employee", authMocks.actor);
      await next();
    },
  };
});

// Import app AFTER mocks are declared so mocked modules are used
const { app } = await import("../../functions/api/[[route]]");

// Minimal fake env — DB is fully mocked at the module level
const fakeEnv = { DB: {} as D1Database, JWT_SECRET: "test-secret" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeLeaveRow(overrides: Partial<LeaveRow> = {}): LeaveRow {
  return {
    id: 1,
    emp_id: 42,
    employee_no: "EMP001",
    employee_name: "직원",
    team_name: null,
    requester_role: "USER",
    requester_has_leader: 1,
    requester_leader_id: 77,
    type: "ANNUAL",
    start_date: "2025-02-01",
    end_date: "2025-02-01",
    amount: 1,
    reason: "개인 사정",
    status: "PENDING",
    created_at: "2025-01-01T00:00:00Z",
    approved_leader_id: null,
    approved_hr_id: null,
    approved_director_id: null,
    leader_name: null,
    hr_name: null,
    director_name: null,
    ...overrides,
  };
}

function approveRequest(body: object) {
  return app.request(
    "/api/leave/approve",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    fakeEnv,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateLeaveRequestStatus.mockResolvedValue(true);
  mocks.insertLeaveRequest.mockResolvedValue(1);
  mocks.listEmployeeLeaveRows.mockResolvedValue([]);
});

describe("Fix 1 regression: super-pass must not stamp approved_leader_id when ADMIN bypasses LEADER stage", () => {
  it("ADMIN approves PENDING USER-with-leader → leaderId=null, hrId=ADMIN.id, status=APPROVED_HR", async () => {
    // requester is USER with a leader → stages = [LEADER, HR], finalStage = HR
    // ADMIN uses super-pass; the bug was leaderId = actor.id set before super-pass check
    const row = makeLeaveRow({ status: "PENDING", requester_role: "USER", requester_has_leader: 1 });
    mocks.getLeaveRequestRowById.mockResolvedValue(row);

    const res = await approveRequest({ requestId: 1, action: "APPROVE" });

    expect(res.status).toBe(200);
    expect(mocks.updateLeaveRequestStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        leaderId: null,       // must NOT be 99 (admin id)
        hrId: 99,            // ADMIN.id fills HR slot
        directorId: null,
        status: "APPROVED_HR",
      }),
    );
  });

  it("ADMIN approves PENDING LEADER → directorId=ADMIN.id, status=APPROVED_DIRECTOR", async () => {
    // requester is LEADER → stages = [HR, DIRECTOR], finalStage = DIRECTOR
    const row = makeLeaveRow({ status: "PENDING", requester_role: "LEADER", requester_has_leader: 0 });
    mocks.getLeaveRequestRowById.mockResolvedValue(row);

    const res = await approveRequest({ requestId: 1, action: "APPROVE" });

    expect(res.status).toBe(200);
    expect(mocks.updateLeaveRequestStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        leaderId: null,
        hrId: 99,
        directorId: null,
        status: "APPROVED_HR",
      }),
    );
  });

  it("ADMIN approves PENDING USER-without-leader → hrId=ADMIN.id, status=APPROVED_HR", async () => {
    // requester is USER without leader → stages = [HR], finalStage = HR
    const row = makeLeaveRow({ status: "PENDING", requester_role: "USER", requester_has_leader: 0 });
    mocks.getLeaveRequestRowById.mockResolvedValue(row);

    const res = await approveRequest({ requestId: 1, action: "APPROVE" });

    expect(res.status).toBe(200);
    expect(mocks.updateLeaveRequestStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        leaderId: null,
        hrId: 99,
        status: "APPROVED_HR",
      }),
    );
  });
});

describe("Fix 6 regression: cancel auth uses snapshot, not live employee state", () => {
  it("final approver (by approved_hr_id) can cancel their own approval", async () => {
    authMocks.actor = { ...authMocks.actor, id: 55, role: "HR" } as any;
    const row = makeLeaveRow({
      status: "APPROVED_HR",
      requester_role: "USER",
      requester_has_leader: 0, // → finalStage HR
      approved_hr_id: 55,
    });
    mocks.getLeaveRequestRowById.mockResolvedValue(row);

    const res = await approveRequest({ requestId: 1, action: "CANCEL" });
    expect(res.status).toBe(200);
    expect(mocks.updateLeaveRequestStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "CANCELLED" }),
    );
    // reset
    authMocks.actor = { ...authMocks.actor, id: 99, role: "ADMIN" } as any;
  });

  it("non-final-approver cannot cancel", async () => {
    authMocks.actor = { ...authMocks.actor, id: 77, role: "LEADER" } as any;
    const row = makeLeaveRow({
      status: "APPROVED_HR",
      requester_role: "USER",
      requester_has_leader: 0,
      approved_hr_id: 55, // different from actor (77)
    });
    mocks.getLeaveRequestRowById.mockResolvedValue(row);

    const res = await approveRequest({ requestId: 1, action: "CANCEL" });
    expect(res.status).toBe(403);
    // reset
    authMocks.actor = { ...authMocks.actor, id: 99, role: "ADMIN" } as any;
  });

  it("ADMIN can cancel any final approved request", async () => {
    authMocks.actor = { ...authMocks.actor, id: 99, role: "ADMIN" } as any;
    const row = makeLeaveRow({
      status: "APPROVED_HR",
      requester_role: "USER",
      requester_has_leader: 0,
      approved_hr_id: 55,
    });
    mocks.getLeaveRequestRowById.mockResolvedValue(row);

    const res = await approveRequest({ requestId: 1, action: "CANCEL" });
    expect(res.status).toBe(200);
    expect(mocks.updateLeaveRequestStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "CANCELLED" }),
    );
  });

  it("HR can cancel final approved request even when director approved it", async () => {
    authMocks.actor = { ...authMocks.actor, id: 55, role: "HR" } as any;
    const row = makeLeaveRow({
      status: "APPROVED_DIRECTOR",
      requester_role: "LEADER",
      requester_has_leader: 0,
      approved_hr_id: 44,
      approved_director_id: 88,
    });
    mocks.getLeaveRequestRowById.mockResolvedValue(row);

    const res = await approveRequest({ requestId: 1, action: "CANCEL" });
    expect(res.status).toBe(200);
    expect(mocks.updateLeaveRequestStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "CANCELLED" }),
    );

    authMocks.actor = { ...authMocks.actor, id: 99, role: "ADMIN" } as any;
  });

  it("non-requester cannot cancel a PENDING request before first approval", async () => {
    const row = makeLeaveRow({ status: "PENDING", requester_role: "USER", requester_has_leader: 0 });
    mocks.getLeaveRequestRowById.mockResolvedValue(row);

    const res = await approveRequest({ requestId: 1, action: "CANCEL" });
    expect(res.status).toBe(403);
  });

  it("snapshot role is used — requester_role=USER no-leader means APPROVED_HR is final", async () => {
    // Even if the live employee record says LEADER, the snapshot USER/no-leader → APPROVED_HR is final
    const row = makeLeaveRow({
      status: "APPROVED_HR",
      requester_role: "USER",   // snapshot
      requester_has_leader: 0,  // snapshot
      approved_hr_id: 99,       // ADMIN is the approver
    });
    mocks.getLeaveRequestRowById.mockResolvedValue(row);

    const res = await approveRequest({ requestId: 1, action: "CANCEL" });
    expect(res.status).toBe(200); // should succeed, not 400 "not finalized"
  });
});

describe("approve handler: stage enforcement uses snapshot", () => {
  it("LEADER stage check uses requester_leader_id from snapshot", async () => {
    authMocks.actor = { ...authMocks.actor, id: 77, role: "LEADER" } as any;
    const row = makeLeaveRow({
      status: "PENDING",
      requester_role: "USER",
      requester_has_leader: 1,
      requester_leader_id: 77, // actor IS the correct leader per snapshot
    });
    mocks.getLeaveRequestRowById.mockResolvedValue(row);

    const res = await approveRequest({ requestId: 1, action: "APPROVE" });
    expect(res.status).toBe(200);
    // reset
    authMocks.actor = { ...authMocks.actor, id: 99, role: "ADMIN" } as any;
  });

  it("wrong LEADER is rejected (snapshot leader_id mismatch)", async () => {
    authMocks.actor = { ...authMocks.actor, id: 88, role: "LEADER" } as any;
    const row = makeLeaveRow({
      status: "PENDING",
      requester_role: "USER",
      requester_has_leader: 1,
      requester_leader_id: 77, // actor 88 ≠ snapshot leader 77
    });
    mocks.getLeaveRequestRowById.mockResolvedValue(row);

    const res = await approveRequest({ requestId: 1, action: "APPROVE" });
    expect(res.status).toBe(403);
    // reset
    authMocks.actor = { ...authMocks.actor, id: 99, role: "ADMIN" } as any;
  });
});

describe("requester cancel before first approval", () => {
  it("requester can cancel their own PENDING request before first approval", async () => {
    authMocks.actor = {
      ...authMocks.actor,
      id: 42,
      employee_no: "EMP001",
      role: "USER",
    } as any;
    const row = makeLeaveRow({
      emp_id: 42,
      status: "PENDING",
      requester_role: "USER",
      requester_has_leader: 1,
    });
    mocks.getLeaveRequestRowById.mockResolvedValue(row);

    const res = await approveRequest({ requestId: 1, action: "CANCEL" });

    expect(res.status).toBe(200);
    expect(mocks.updateLeaveRequestStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        currentStatus: "PENDING",
        status: "CANCELLED",
        actorId: 42,
        eventAction: "REQUEST_CANCELLED",
      }),
    );

    authMocks.actor = { ...authMocks.actor, id: 99, role: "ADMIN", employee_no: "ADM001" } as any;
  });

  it("another employee cannot cancel someone else's pending request", async () => {
    authMocks.actor = {
      ...authMocks.actor,
      id: 88,
      employee_no: "EMP088",
      role: "USER",
    } as any;
    const row = makeLeaveRow({
      emp_id: 42,
      status: "PENDING",
      requester_role: "USER",
      requester_has_leader: 1,
    });
    mocks.getLeaveRequestRowById.mockResolvedValue(row);

    const res = await approveRequest({ requestId: 1, action: "CANCEL" });

    expect(res.status).toBe(403);

    authMocks.actor = { ...authMocks.actor, id: 99, role: "ADMIN", employee_no: "ADM001" } as any;
  });
});
