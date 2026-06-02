import { useEffect, useRef, useState } from "react";
import { DashboardShell } from "./components/dashboard-shell";
import { BrandMark } from "./components/brand-mark";
import { LoginScreen } from "./components/login-screen";
import { useAuthStore } from "./stores/auth-store";

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const SESSION_TIMEOUT_TOAST_MS = 900;

function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-backdrop px-6 py-10">
      <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white/88 p-8 shadow-panel backdrop-blur">
        <BrandMark compact className="mx-auto" />
        <p className="mt-6 text-center text-sm font-medium text-slate-500">세션 확인 중입니다.</p>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-mist">
          <div className="h-full w-1/2 rounded-full bg-hero" />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const initialized = useAuthStore((state) => state.initialized);
  const user = useAuthStore((state) => state.user);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const logout = useAuthStore((state) => state.logout);
  const [timeoutToast, setTimeoutToast] = useState<string | null>(null);
  const inactivityTimerRef = useRef<number | null>(null);
  const redirectTimerRef = useRef<number | null>(null);
  const expiringSessionRef = useRef(false);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    if (!user) return;
    if (window.location.pathname === "/login") {
      window.history.replaceState({}, "", "/");
    }
  }, [user]);

  useEffect(() => {
    if (!user || !initialized) {
      expiringSessionRef.current = false;
      setTimeoutToast(null);
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
      return;
    }

    const clearTimers = () => {
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };

    const expireSessionNow = () => {
      clearTimers();
      expiringSessionRef.current = true;
      setTimeoutToast("세션이 만료되었습니다");
      redirectTimerRef.current = window.setTimeout(() => {
        void (async () => {
          try {
            await logout();
          } finally {
            window.history.replaceState({}, "", "/login");
            setTimeoutToast(null);
            expiringSessionRef.current = false;
          }
        })();
      }, SESSION_TIMEOUT_TOAST_MS);
    };

    const resetInactivityTimer = () => {
      if (expiringSessionRef.current) return;
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
      }
      inactivityTimerRef.current = window.setTimeout(expireSessionNow, INACTIVITY_TIMEOUT_MS);
    };

    const handleInteraction = () => {
      resetInactivityTimer();
    };

    resetInactivityTimer();
    window.addEventListener("click", handleInteraction);
    window.addEventListener("keydown", handleInteraction);

    return () => {
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      clearTimers();
    };
  }, [initialized, logout, user]);

  let content = null;

  if (!initialized) {
    content = <SplashScreen />;
  } else if (!user) {
    content = <LoginScreen />;
  } else {
    content = <DashboardShell />;
  }

  return (
    <>
      {content}
      {timeoutToast ? (
        <div className="fixed bottom-24 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-brand-slate px-4 py-2 text-sm text-white shadow-lg shadow-brand-slate/20">
          {timeoutToast}
        </div>
      ) : null}
    </>
  );
}
