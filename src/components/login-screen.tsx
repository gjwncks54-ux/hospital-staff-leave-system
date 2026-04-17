import { FormEvent, useState } from "react";
import { BrandMark } from "./brand-mark";
import { useAuthStore } from "../stores/auth-store";

export function LoginScreen() {
  const [employeeNo, setEmployeeNo] = useState("");
  const [password, setPassword] = useState("");
  const [justSubmitted, setJustSubmitted] = useState(false);

  const login = useAuthStore((state) => state.login);
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJustSubmitted(true);
    await login(employeeNo, password);
  }

  return (
    <div className="min-h-screen bg-backdrop px-4 py-6 text-ink sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-md flex-col justify-center gap-4">
        <section className="rounded-[2rem] border border-white/70 bg-white/92 px-5 py-6 shadow-panel backdrop-blur sm:px-6">
          <BrandMark className="mx-auto" />

          <div className="mt-6">
            <h1 className="text-[1.8rem] font-semibold tracking-tight text-ink">직원 전용 로그인</h1>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-600">사번</span>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-base outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                value={employeeNo}
                onChange={(event) => {
                  clearError();
                  setEmployeeNo(event.target.value);
                }}
                placeholder="예: WB-0000"
                autoComplete="username"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-600">비밀번호</span>
              <input
                type="password"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-base outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                value={password}
                onChange={(event) => {
                  clearError();
                  setPassword(event.target.value);
                }}
                placeholder="비밀번호"
                autoComplete="current-password"
              />
            </label>

            {error && justSubmitted ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div> : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-hero px-4 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-slate/15 transition hover:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "로그인 중..." : "로그인"}
            </button>
          </form>
        </section>

      </div>
    </div>
  );
}
