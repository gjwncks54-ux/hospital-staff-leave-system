import { useEffect } from "react";
import { DashboardShell } from "./components/dashboard-shell";
import { LoginScreen } from "./components/login-screen";
import { useAuthStore } from "./stores/auth-store";

function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-backdrop px-6 py-10">
      <div className="w-full max-w-sm rounded-[2rem] border border-white/60 bg-white/80 p-8 text-center shadow-panel backdrop-blur">
        <div className="mx-auto mb-5 h-16 w-16 rounded-[1.5rem] bg-hero" />
        <p className="text-sm font-medium text-slate-500">세션과 휴가 정책을 확인하고 있습니다.</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">소중한병원 휴가관리</h1>
      </div>
    </div>
  );
}

export default function App() {
  const initialized = useAuthStore((state) => state.initialized);
  const user = useAuthStore((state) => state.user);
  const restoreSession = useAuthStore((state) => state.restoreSession);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  if (!initialized) {
    return <SplashScreen />;
  }

  if (!user) {
    return <LoginScreen />;
  }

  return <DashboardShell />;
}
