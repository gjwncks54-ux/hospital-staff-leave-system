import { FormEvent, useMemo, useState } from "react";
import { BrandMark } from "./brand-mark";
import { useAuthStore } from "../stores/auth-store";

const demoAccounts = [
  { label: "직원", employeeNo: "SH-2024-013", password: "Pilot2026!", helper: "본인 신청과 내역 조회" },
  { label: "팀장", employeeNo: "SH-2021-004", password: "Pilot2026!", helper: "팀장 승인 후 인사 결재" },
  { label: "인사", employeeNo: "SH-2020-001", password: "Pilot2026!", helper: "직원 연차 최종 승인, 팀장 연차 1차 승인" },
  { label: "원장", employeeNo: "SH-2018-001", password: "Pilot2026!", helper: "팀장 연차 최종 승인" },
];

export function LoginScreen() {
  const [employeeNo, setEmployeeNo] = useState("SH-2024-013");
  const [password, setPassword] = useState("Pilot2026!");
  const [justSubmitted, setJustSubmitted] = useState(false);

  const login = useAuthStore((state) => state.login);
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  const credentialHint = useMemo(() => demoAccounts.find((account) => account.employeeNo === employeeNo), [employeeNo]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJustSubmitted(true);
    await login(employeeNo, password);
  }

  return (
    <div className="min-h-screen bg-backdrop px-4 py-6 text-ink sm:py-10">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-5xl gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative overflow-hidden rounded-[2rem] bg-hero px-6 py-8 text-white shadow-panel">
          <div className="pointer-events-none absolute -right-8 -top-8 h-56 w-56 rounded-full bg-white/12 blur-3xl" />
          <div className="relative">
            <BrandMark />
            <p className="mt-8 text-sm leading-7 text-white/82">
              소중한병원 연차관리를 청록 기반 브랜드 톤으로 정리했습니다. 직원 연차는 팀장 → 인사, 팀장 연차는 인사 → 원장
              흐름으로 처리됩니다.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.5rem] bg-white/12 p-4 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-white/70">Workflow</p>
                <p className="mt-2 text-lg font-semibold">연차 결재선 분리</p>
              </div>
              <div className="rounded-[1.5rem] bg-white/12 p-4 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-white/70">Board</p>
                <p className="mt-2 text-lg font-semibold">공지사항 + 이모지 지원</p>
              </div>
              <div className="rounded-[1.5rem] bg-white/12 p-4 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-white/70">Export</p>
                <p className="mt-2 text-lg font-semibold">필터 후 엑셀 다운로드</p>
              </div>
              <div className="rounded-[1.5rem] bg-white/12 p-4 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-white/70">One Step</p>
                <p className="mt-2 text-lg font-semibold">제안 링크 바로가기</p>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/92 shadow-panel backdrop-blur">
          <div className="px-6 pb-6 pt-7">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-slate/55">Secure Login</p>
            <h1 className="mt-2 text-[2rem] font-semibold tracking-tight text-ink">연차관리 로그인</h1>
            <p className="mt-3 text-sm leading-7 text-slate-500">테스트 계정을 선택하거나 사번과 비밀번호로 바로 로그인하세요.</p>
          </div>

          <div className="bg-mist/70 px-5 pb-6 pt-5">
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
                <div className="rounded-2xl bg-accent/10 px-4 py-3 text-sm text-accent-strong">
                  <strong className="font-semibold">{credentialHint.label}</strong> 계정입니다. {credentialHint.helper}
                </div>
              ) : null}

              {error && justSubmitted ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div> : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-hero px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-accent/15 transition hover:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="flex w-full items-center justify-between rounded-2xl border border-white bg-white px-4 py-3 text-left shadow-card transition hover:border-accent/25 hover:bg-accent/5"
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
          </div>
        </section>
      </div>
    </div>
  );
}
