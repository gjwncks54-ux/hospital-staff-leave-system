import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import type { JWTPayload } from "hono/utils/jwt/types";
import type { MiddlewareHandler } from "hono";
import { getEmployeeById, toSessionUser, type EmployeeRecord, type UserRole } from "./db";

export interface SessionPayload extends JWTPayload {
  sub: number;
  employeeNo: string;
  role: UserRole;
  name: string;
  exp: number;
}

interface Env {
  Bindings: {
    DB: D1Database;
    JWT_SECRET: string;
    SESSION_COOKIE_NAME?: string;
  };
  Variables: {
    employee: EmployeeRecord;
  };
}

function textToHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  return new Uint8Array(hex.match(/.{1,2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, part2, part3, part4] = storedHash.split("$");
  if (!algorithm || !part2 || !part3) {
    return false;
  }

  if (algorithm === "sha256") {
    const derived = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${password}:${part2}`));
    return textToHex(derived) === part3;
  }

  if (algorithm === "pbkdf2_sha256" && part4) {
    const iterations = Number(part2);
    const passwordKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const derived = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: hexToBytes(part3),
        iterations,
      },
      passwordKey,
      256,
    );

    return textToHex(derived) === part4;
  }

  return false;
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: 120000,
    },
    passwordKey,
    256,
  );

  return `pbkdf2_sha256$120000$${bytesToHex(salt)}$${textToHex(derived)}`;
}

export function sessionCookieName(env: Env["Bindings"]) {
  return env.SESSION_COOKIE_NAME || "hospital_leave_session";
}

export async function createSessionToken(env: Env["Bindings"], employee: EmployeeRecord) {
  const payload: SessionPayload = {
    sub: employee.id,
    employeeNo: employee.employee_no,
    role: employee.role,
    name: employee.name,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
  };

  return sign(payload, env.JWT_SECRET, "HS256");
}

export async function setSession(env: Env["Bindings"], url: string, employee: EmployeeRecord, c: Parameters<MiddlewareHandler<Env>>[0]) {
  const token = await createSessionToken(env, employee);
  const secure = new URL(url).protocol === "https:";

  setCookie(c, sessionCookieName(env), token, {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export function clearSession(env: Env["Bindings"], c: Parameters<MiddlewareHandler<Env>>[0]) {
  deleteCookie(c, sessionCookieName(env), {
    path: "/",
  });
}

export async function getCurrentEmployee(c: Parameters<MiddlewareHandler<Env>>[0]) {
  const token = getCookie(c, sessionCookieName(c.env));
  if (!token) {
    return null;
  }

  try {
    const payload = (await verify(token, c.env.JWT_SECRET, "HS256")) as unknown as SessionPayload;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    const employee = await getEmployeeById(c.env.DB, Number(payload.sub));
    if (!employee || employee.is_active !== 1) {
      return null;
    }

    return employee;
  } catch {
    return null;
  }
}

export function authGuard(roles?: UserRole[]): MiddlewareHandler<Env> {
  return async (c, next) => {
    const employee = await getCurrentEmployee(c);
    if (!employee) {
      return c.json({ message: "로그인이 필요합니다." }, 401);
    }

    if (roles && !roles.includes(employee.role)) {
      return c.json({ message: "이 작업을 수행할 권한이 없습니다." }, 403);
    }

    c.set("employee", employee);
    await next();
  };
}

export function serializeEmployee(record: EmployeeRecord) {
  return toSessionUser(record);
}
