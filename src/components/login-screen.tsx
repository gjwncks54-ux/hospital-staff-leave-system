import { FormEvent, useMemo, useState } from "react";
import { useAuthStore } from "../stores/auth-store";

const demoAccounts = [
  { label: "직원", employeeNo: "SH-2024-013", password: "Pilot2026!", helper: "본인 신청과 내역 조회" },
  { label: "팀장", employeeNo: "SH-2021-004", password: "Pilot2026!", helper: "1차 승인과 팀 일정 확인" },
  { label: "인사", employeeNo: "SH-2020-001", password: "Pilot2026!", helper: "최종 승인과 잔여 연차 검토" },
  { label: "원장", employeeNo: "SH-2018-001", password: "Pilot2026!", helper: "전체 조회와 예외 승인 확인" },
];

export function LoginScreen() {
  const [employeeNo, setEmployeeNo] = useState("SH-2024-013");
  const [password, setPassword] = useState("Pilot2026!");
  const [justSubmitted, setJustSubmitted] = useState(false);

  const login = useAuthStore((state) => state.login);
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  const credentialHint = useMemo(
    () => demoAccounts.find((account) => account.employeeNo === employeeNo),
    [employeeNo],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJustSubmitted(true);
    await login(employeeNo, password);
  }

  return (
    <div className="min-h-screen bg-backdrop px-4 py-6 text-ink sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-sm flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-white/90 shadow-panel backdrop-blur">
        <div className="relative overflow-hidden px-6 pb-6 pt-8">
          <div className="absolute right-0 top-0 h-44 w-44 translate-x-8 -translate-y-12 rounded-full bg-accent/15 blur-3xl" />
          <div className="relative">
            <div className="flex h-14 w-14 items-center justify-center rounded-[1.35rem] bg-hero text-2xl font-semibold text-white shadow-lg shadow-blue-600/20">
              휴
            </div>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Hospital Leave Pilot</p>
            <h1 className="mt-2 text-[2rem] font-semibold tracking-tight text-ink">소중한병원 휴가관리</h1>
            <p className="mt-3 max-w-xs text-sm leading-6 text-slate-500">
              스마트폰 중심으로 구성한 병원 직원용 휴가 신청 및 승인 웹앱 파일럿입니다.
            </p>
          </div>
        </div>

        <div className="flex-1 bg-slate-50/60 px-5 pb-6 pt-5">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-600">사번</span>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                value={employeeNo}
                onChange={(event) => {
                  clearError();
                  setEmployeeNo(event.target.value);
                }}
                placeholder="예: SH-2024-013"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-600">비밀번호</span>
              <input
                type="password"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                value={password}
                onChange={(event) => {
                  clearError();
                  setPassword(event.target.value);
                }}
                placeholder="비밀번호"
              />
            </label>

            {credentialHint ? (
              <div className="rounded-2xl bg-accent/8 px-4 py-3 text-sm text-accent-strong">
                <strong className="font-semibold">{credentialHint.label}</strong> 데모 계정입니다. {credentialHint.helper}
              </div>
            ) : null}

            {error && justSubmitted ? (
              <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-hero px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "로그인 중..." : "로그인"}
            </button>
          </form>

          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-600">테스트 계정</h2>
              <span className="text-xs text-slate-400">비밀번호는 모두 동일합니다.</span>
            </div>

            {demoAccounts.map((account) => (
              <button
                key={account.employeeNo}
                type="button"
                className="flex w-full items-center justify-between rounded-2xl border border-white bg-white px-4 py-3 text-left shadow-card transition hover:border-accent/20 hover:bg-accent/5"
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
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">불러오기</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
