export type LoginFailureScope = "IP" | "EMPLOYEE_NO";

export const LOGIN_RATE_LIMIT = {
  employeeWindowMinutes: 10,
  employeeMaxFailures: 5,
  ipWindowMinutes: 10,
  ipMaxFailures: 30,
  retentionMinutes: 24 * 60,
  retryAfterSeconds: 10 * 60,
} as const;

interface LoginFailureCountRow {
  count: number;
}

function retentionModifier(minutes: number) {
  return `-${minutes} minutes`;
}

export function normalizeEmployeeNoForRateLimit(employeeNo: string) {
  return employeeNo.trim().toUpperCase();
}

async function pruneExpiredLoginFailures(db: D1Database) {
  await db
    .prepare(
      `
        DELETE FROM login_failures
        WHERE datetime(created_at) < datetime('now', ?)
      `,
    )
    .bind(retentionModifier(LOGIN_RATE_LIMIT.retentionMinutes))
    .run();
}

async function countRecentLoginFailures(
  db: D1Database,
  scope: LoginFailureScope,
  identifier: string,
  windowMinutes: number,
) {
  const row = await db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM login_failures
        WHERE scope = ?
          AND identifier = ?
          AND datetime(created_at) >= datetime('now', ?)
      `,
    )
    .bind(scope, identifier, retentionModifier(windowMinutes))
    .first<LoginFailureCountRow>();

  return Number(row?.count ?? 0);
}

async function recordLoginFailure(db: D1Database, scope: LoginFailureScope, identifier: string) {
  await db
    .prepare(
      `
        INSERT INTO login_failures (scope, identifier)
        VALUES (?, ?)
      `,
    )
    .bind(scope, identifier)
    .run();
}

export async function getLoginRateLimitState(db: D1Database, clientIp: string, employeeNo: string) {
  await pruneExpiredLoginFailures(db);

  const [ipFailures, employeeFailures] = await Promise.all([
    countRecentLoginFailures(db, "IP", clientIp, LOGIN_RATE_LIMIT.ipWindowMinutes),
    countRecentLoginFailures(db, "EMPLOYEE_NO", employeeNo, LOGIN_RATE_LIMIT.employeeWindowMinutes),
  ]);

  return {
    ipFailures,
    employeeFailures,
    blocked: ipFailures >= LOGIN_RATE_LIMIT.ipMaxFailures || employeeFailures >= LOGIN_RATE_LIMIT.employeeMaxFailures,
    retryAfterSeconds: LOGIN_RATE_LIMIT.retryAfterSeconds,
  };
}

export async function recordFailedLoginAttempt(db: D1Database, clientIp: string, employeeNo: string) {
  await Promise.all([
    recordLoginFailure(db, "IP", clientIp),
    recordLoginFailure(db, "EMPLOYEE_NO", employeeNo),
  ]);
}

export async function clearEmployeeLoginFailures(db: D1Database, employeeNo: string) {
  await db
    .prepare(
      `
        DELETE FROM login_failures
        WHERE scope = 'EMPLOYEE_NO'
          AND identifier = ?
      `,
    )
    .bind(employeeNo)
    .run();
}
