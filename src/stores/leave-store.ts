import { create } from "zustand";
import {
  actOnLeaveRequest,
  ApiError,
  createLeaveRequest,
  fetchLeaveBalance,
  fetchLeaveHistory,
  fetchPendingApprovals,
} from "../lib/api";
import type { ApprovalActionInput, LeaveRequestInput, LeaveRequestItem, LeaveSummary, UserRole } from "../types";

interface LeaveState {
  summary: LeaveSummary | null;
  history: LeaveRequestItem[];
  approvals: LeaveRequestItem[];
  loading: boolean;
  submitting: boolean;
  error: string | null;
  refresh: (employeeId: number, role: UserRole) => Promise<void>;
  submitRequest: (payload: LeaveRequestInput, employeeId: number, role: UserRole) => Promise<boolean>;
  actOnRequest: (payload: ApprovalActionInput, employeeId: number, role: UserRole) => Promise<boolean>;
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
  loading: false,
  submitting: false,
  error: null,
  async refresh(employeeId, role) {
    set({ loading: true, error: null });

    try {
      const [summary, history, approvals] = await Promise.all([
        fetchLeaveBalance(employeeId),
        fetchLeaveHistory(),
        canReview(role) ? fetchPendingApprovals() : Promise.resolve({ items: [] }),
      ]);

      set({
        summary,
        history: history.items,
        approvals: approvals.items,
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
  clearError() {
    set({ error: null });
  },
}));
