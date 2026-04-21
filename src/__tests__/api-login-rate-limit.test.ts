import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getEmployeeByEmployeeNo: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  setSession: vi.fn(),
}));

const rateLimitMocks = vi.hoisted(() => ({
  getLoginRateLimitState: vi.fn(),
  recordFailedLoginAttempt: vi.fn(),
  clearEmployeeLoginFailures: vi.fn(),
}));

vi.mock("../../functions/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../functions/lib/db")>();
  return {
    ...actual,
    getEmployeeByEmployeeNo: dbMocks.getEmployeeByEmployeeNo,
  };
});

vi.mock("../../functions/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../functions/lib/auth")>();
  return {
    ...actual,
    verifyPassword: authMocks.verifyPassword,
    setSession: authMocks.setSession,
  };
});

vi.mock("../../functions/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../functions/lib/rate-limit")>();
  return {
    ...actual,
    LOGIN_RATE_LIMIT: {
      employeeWindowMinutes: 10,
      employeeMaxFailures: 5,
      ipWindowMinutes: 10,
      ipMaxFailures: 30,
      retentionMinutes: 1440,
      retryAfterSeconds: 600,
    },
    getLoginRateLimitState: rateLimitMocks.getLoginRateLimitState,
    recordFailedLoginAttempt: rateLimitMocks.recordFailedLoginAttempt,
    clearEmployeeLoginFailures: rateLimitMocks.clearEmployeeLoginFailures,
  };
});

const { app } = await import("../../functions/api/[[route]]");

const fakeEnv = { DB: {} as D1Database, JWT_SECRET: "test-secret" };

const activeEmployee = {
  id: 1,
  employee_no: "WB-0001",
  name: "직원",
  email: "user@example.com",
  role: "USER" as const,
  joined_at: "2024-01-01",
  leave_adjustment_days: 0,
  retired_at: null,
  leader_id: null,
  is_active: 1,
  password_hash: "hash",
  org_unit_id: null,
  team_name: null,
  division_name: null,
  root_name: null,
};

function login(body: object, headers: Record<string, string> = {}) {
  return app.request(
    "/api/auth/login",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    },
    fakeEnv,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMocks.getLoginRateLimitState.mockResolvedValue({
    ipFailures: 0,
    employeeFailures: 0,
    blocked: false,
    retryAfterSeconds: 600,
  });
  dbMocks.getEmployeeByEmployeeNo.mockResolvedValue(activeEmployee);
  authMocks.verifyPassword.mockResolvedValue(true);
  authMocks.setSession.mockResolvedValue(undefined);
  rateLimitMocks.recordFailedLoginAttempt.mockResolvedValue(undefined);
  rateLimitMocks.clearEmployeeLoginFailures.mockResolvedValue(undefined);
});

describe("login rate limit", () => {
  it("returns 429 when the request is already rate limited", async () => {
    rateLimitMocks.getLoginRateLimitState.mockResolvedValue({
      ipFailures: 30,
      employeeFailures: 0,
      blocked: true,
      retryAfterSeconds: 600,
    });

    const res = await login({ employeeNo: "WB-0001", password: "password123" });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("600");
    expect(dbMocks.getEmployeeByEmployeeNo).not.toHaveBeenCalled();
  });

  it("records a failed attempt and returns 401 for invalid password below threshold", async () => {
    authMocks.verifyPassword.mockResolvedValue(false);

    const res = await login(
      { employeeNo: "WB-0001", password: "wrong-password" },
      { "CF-Connecting-IP": "203.0.113.10" },
    );

    expect(res.status).toBe(401);
    expect(rateLimitMocks.recordFailedLoginAttempt).toHaveBeenCalledWith(
      expect.anything(),
      "203.0.113.10",
      "WB-0001",
    );
    expect(rateLimitMocks.clearEmployeeLoginFailures).not.toHaveBeenCalled();
  });

  it("clears employee-scoped failures after a successful login", async () => {
    const res = await login(
      { employeeNo: "WB-0001", password: "correct-password" },
      { "CF-Connecting-IP": "203.0.113.10" },
    );

    expect(res.status).toBe(200);
    expect(rateLimitMocks.clearEmployeeLoginFailures).toHaveBeenCalledWith(
      expect.anything(),
      "WB-0001",
    );
    expect(authMocks.setSession).toHaveBeenCalled();
  });
});
