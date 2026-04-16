import { FormEvent, useState } from "react";
import { BrandMark } from "./brand-mark";
import { useAuthStore } from "../stores/auth-store";

const demoAccounts = [
  { label: "직원", employeeNo: "SH-2024-013", password: "Pilot2026!", helper: "신청 / 내역 조회" },
  { label: "팀장", employeeNo: "SH-2021-004", password: "Pilot2026!", helper: "1차 승인" },
  { label: "인사", employeeNo: "SH-2020-001", password: "Pilot2026!", helper: "최종 승인" },
  { label: "원장", employeeNo: "SH-2018-001", password: "Pilot2026!", helper: "최종 승인 조회" },
];

export function LoginScreen() {
  const [employeeNo, setEmployeeNo] = useState("SH-2024-013");
  const [password, setPassword] = useState("Pilot2026!");
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
                placeholder="예: SH-2024-013"
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

        <section className="rounded-[1.8rem] border border-white/70 bg-white/90 px-4 py-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink">테스트 계정</h2>
            <span className="text-xs text-slate-400">비밀번호 공통: Pilot2026!</span>
          </div>

          <div className="mt-3 space-y-2.5">
            {demoAccounts.map((account) => (
              <button
                key={account.employeeNo}
                type="button"
                className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3 text-left shadow-card transition hover:border-accent/25 hover:bg-accent/5"
                onClick={() => {
                  clearError();
                  setEmployeeNo(account.employeeNo);
                  setPassword(account.password);
                }}
              >
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {account.label} · {account.employeeNo}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{account.helper}</p>
                </div>
                <span className="rounded-full bg-mist px-2.5 py-1 text-[11px] font-semibold text-brand-slate">불러오기</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
