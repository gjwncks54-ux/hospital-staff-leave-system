import { create } from "zustand";
import { ApiError, login as loginApi, logout as logoutApi, restoreSession as restoreSessionApi } from "../lib/api";
import type { SessionUser } from "../types";

interface AuthState {
  user: SessionUser | null;
  initialized: boolean;
  loading: boolean;
  error: string | null;
  login: (employeeNo: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  initialized: false,
  loading: false,
  error: null,
  async login(employeeNo, password) {
    set({ loading: true, error: null });

    try {
      const response = await loginApi(employeeNo, password);
      set({ user: response.user, initialized: true, loading: false });
      return true;
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "로그인에 실패했습니다. 사번과 비밀번호를 다시 확인해주세요.";
      set({ error: message, loading: false, initialized: true });
      return false;
    }
  },
  async logout() {
    try {
      await logoutApi();
    } finally {
      set({ user: null, error: null, initialized: true, loading: false });
    }
  },
  async restoreSession() {
    set({ loading: true });
    try {
      const response = await restoreSessionApi();
      set({ user: response.user, initialized: true, loading: false, error: null });
    } catch {
      set({ user: null, initialized: true, loading: false, error: null });
    }
  },
  clearError() {
    set({ error: null });
  },
}));
