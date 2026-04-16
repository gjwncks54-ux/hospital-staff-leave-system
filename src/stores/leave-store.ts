import { create } from "zustand";
import {
  actOnLeaveRequest,
  ApiError,
  createLeaveRequest,
  createNotice as createNoticeApi,
  deleteNotice as deleteNoticeApi,
  fetchLeaveBalance,
  fetchLeaveHistory,
  fetchNotices,
  fetchPendingApprovals,
  updateNotice as updateNoticeApi,
} from "../lib/api";
import type {
  ApprovalActionInput,
  LeaveRequestInput,
  LeaveRequestItem,
  LeaveSummary,
  NoticeItem,
  UserRole,
} from "../types";

interface LeaveState {
  summary: LeaveSummary | null;
  history: LeaveRequestItem[];
  approvals: LeaveRequestItem[];
  notices: NoticeItem[];
  loading: boolean;
  submitting: boolean;
  postingNotice: boolean;
  error: string | null;
  refresh: (employeeId: number, role: UserRole) => Promise<void>;
  submitRequest: (payload: LeaveRequestInput, employeeId: number, role: UserRole) => Promise<boolean>;
  actOnRequest: (payload: ApprovalActionInput, employeeId: number, role: UserRole) => Promise<boolean>;
  createNotice: (payload: { title: string; content: string }, employeeId: number, role: UserRole) => Promise<boolean>;
  updateNotice: (noticeId: number, payload: { title: string; content: string }, employeeId: number, role: UserRole) => Promise<boolean>;
  deleteNotice: (noticeId: number, employeeId: number, role: UserRole) => Promise<boolean>;
  clearError: () => void;
}

function canReview(role: UserRole) {
  return role === "LEADER" || role === "HR" || role === "ADMIN" || role === "DIRECTOR";
}

async function refreshAfterConflict(error: unknown, employeeId: number, role: UserRole) {
  if (error instanceof ApiError && error.status === 409) {
    await useLeaveStore.getState().refresh(employeeId, role);
  }
}

export const useLeaveStore = create<LeaveState>((set) => ({
  summary: null,
  history: [],
  approvals: [],
  notices: [],
  loading: false,
  submitting: false,
  postingNotice: false,
  error: null,
  async refresh(employeeId, role) {
    set({ loading: true, error: null });

    try {
      const [summary, history, approvals, notices] = await Promise.all([
        fetchLeaveBalance(employeeId),
        fetchLeaveHistory(),
        canReview(role) ? fetchPendingApprovals() : Promise.resolve({ items: [] }),
        fetchNotices(),
      ]);

      set({
        summary,
        history: history.items,
        approvals: approvals.items,
        notices: notices.items,
        loading: false,
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "휴가 데이터를 불러오지 못했습니다.";
      set({ error: message, loading: false });
    }
  },
  async submitRequest(payload, employeeId, role) {
    set({ submitting: true, error: null });

    try {
      await createLeaveRequest(payload);
      await useLeaveStore.getState().refresh(employeeId, role);
      set({ submitting: false });
      return true;
    } catch (error) {
      await refreshAfterConflict(error, employeeId, role);
      const message = error instanceof ApiError ? error.message : "휴가 신청에 실패했습니다.";
      set({ error: message, submitting: false });
      return false;
    }
  },
  async actOnRequest(payload, employeeId, role) {
    set({ submitting: true, error: null });

    try {
      await actOnLeaveRequest(payload);
      await useLeaveStore.getState().refresh(employeeId, role);
      set({ submitting: false });
      return true;
    } catch (error) {
      await refreshAfterConflict(error, employeeId, role);
      const message = error instanceof ApiError ? error.message : "결재 처리에 실패했습니다.";
      set({ error: message, submitting: false });
      return false;
    }
  },
  async createNotice(payload, employeeId, role) {
    set({ postingNotice: true, error: null });

    try {
      await createNoticeApi(payload);
      await useLeaveStore.getState().refresh(employeeId, role);
      set({ postingNotice: false });
      return true;
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "공지 등록에 실패했습니다.";
      set({ error: message, postingNotice: false });
      return false;
    }
  },
  async updateNotice(noticeId, payload, employeeId, role) {
    set({ postingNotice: true, error: null });

    try {
      await updateNoticeApi(noticeId, payload);
      await useLeaveStore.getState().refresh(employeeId, role);
      set({ postingNotice: false });
      return true;
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "공지 수정에 실패했습니다.";
      set({ error: message, postingNotice: false });
      return false;
    }
  },
  async deleteNotice(noticeId, employeeId, role) {
    set({ postingNotice: true, error: null });

    try {
      await deleteNoticeApi(noticeId);
      await useLeaveStore.getState().refresh(employeeId, role);
      set({ postingNotice: false });
      return true;
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "공지 삭제에 실패했습니다.";
      set({ error: message, postingNotice: false });
      return false;
    }
  },
  clearError() {
    set({ error: null });
  },
}));
