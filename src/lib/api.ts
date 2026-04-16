import type {
  ApprovalActionInput,
  AuthResponse,
  LeaveRequestInput,
  LeaveRequestItem,
  LeaveSummary,
  NoticeItem,
} from "../types";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function requestJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const fallbackMessage = response.status === 401 ? "로그인이 필요합니다." : "요청을 처리하지 못했습니다.";
    try {
      const payload = (await response.json()) as { message?: string };
      throw new ApiError(payload.message ?? fallbackMessage, response.status);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(fallbackMessage, response.status);
    }
  }

  return (await response.json()) as T;
}

export { ApiError };

export function login(employeeNo: string, password: string) {
  return requestJSON<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ employeeNo, password }),
  });
}

export function logout() {
  return requestJSON<{ ok: true }>("/api/auth/logout", {
    method: "POST",
  });
}

export function restoreSession() {
  return requestJSON<AuthResponse>("/api/auth/session");
}

export function fetchNotices() {
  return requestJSON<{ items: NoticeItem[] }>("/api/notices");
}

export function createNotice(input: { title: string; content: string }) {
  return requestJSON<{ item: NoticeItem | null }>("/api/notices", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateNotice(noticeId: number, input: { title: string; content: string }) {
  return requestJSON<{ item: NoticeItem | null }>(`/api/notices/${noticeId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteNotice(noticeId: number) {
  return requestJSON<{ ok: true }>(`/api/notices/${noticeId}`, {
    method: "DELETE",
  });
}

export function fetchLeaveBalance(employeeId: number) {
  return requestJSON<LeaveSummary>(`/api/leave/balance/${employeeId}`);
}

export function fetchLeaveHistory() {
  return requestJSON<{ items: LeaveRequestItem[] }>("/api/leave/history");
}

export function fetchPendingApprovals() {
  return requestJSON<{ items: LeaveRequestItem[] }>("/api/approvals/pending");
}

export function createLeaveRequest(input: LeaveRequestInput) {
  return requestJSON<{ item: LeaveRequestItem }>("/api/leave/request", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function actOnLeaveRequest(input: ApprovalActionInput) {
  return requestJSON<{ item: LeaveRequestItem }>("/api/leave/approve", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
