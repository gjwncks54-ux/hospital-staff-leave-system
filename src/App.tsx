import { useEffect } from "react";
import { DashboardShell } from "./components/dashboard-shell";
import { BrandMark } from "./components/brand-mark";
import { LoginScreen } from "./components/login-screen";
import { useAuthStore } from "./stores/auth-store";

function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-backdrop px-6 py-10">
      <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-panel backdrop-blur">
        <BrandMark compact />
        <p className="mt-6 text-sm font-medium text-slate-500">세션과 휴가 정책을 확인하고 있습니다.</p>
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
