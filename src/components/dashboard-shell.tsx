import { useEffect, useMemo, useRef, useState } from "react";
import { RequestModal } from "./request-modal";
import { useAuthStore } from "../stores/auth-store";
import { useLeaveStore } from "../stores/leave-store";
import type { ApprovalActionInput, LeaveRequestItem, LeaveStatus, LeaveType } from "../types";

type TabKey = "home" | "history" | "approvals" | "profile";

const AUTO_REFRESH_THROTTLE_MS = 3000;
const APPROVAL_POLL_MS = 60000;

const tabs: Array<{ key: TabKey; ko: string; en: string }> = [
  { key: "home", ko: "홈", en: "Home" },
  { key: "history", ko: "내역", en: "History" },
  { key: "approvals", ko: "승인", en: "Approvals" },
  { key: "profile", ko: "프로필", en: "Profile" },
];

function formatNumber(value: number) {
  return value.toFixed(1);
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
}

function formatDateRange(item: LeaveRequestItem) {
  return item.startDate === item.endDate
    ? formatDate(item.startDate)
    : `${formatDate(item.startDate)} - ${formatDate(item.endDate)}`;
}

function typeLabel(type: LeaveType) {
  switch (type) {
    case "HALF_AM":
      return "반차(오전)";
    case "HALF_PM":
      return "반차(오후)";
    case "SICK":
      return "병가";
    default:
      return "연차";
  }
}

function statusLabel(status: LeaveStatus) {
  switch (status) {
    case "APPROVED_LEADER":
      return "팀장 승인";
    case "APPROVED_HR":
      return "최종 승인";
    case "REJECTED":
      return "반려";
    default:
      return "대기중";
  }
}

function statusClass(status: LeaveStatus) {
  switch (status) {
    case "APPROVED_LEADER":
    case "APPROVED_HR":
      return "bg-mint/10 text-mint";
    case "REJECTED":
      return "bg-rose-50 text-rose-600";
    default:
      return "bg-amber-50 text-amber-600";
  }
}

function canApprove(role: string) {
  return role === "LEADER" || role === "HR" || role === "ADMIN" || role === "DIRECTOR";
}

function StepPills({ status }: { status: LeaveStatus }) {
  const teamClass = status === "PENDING" ? "active" : "done";
  const hrClass = status === "APPROVED_HR" ? "done" : status === "APPROVED_LEADER" ? "active" : "";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="rounded-full bg-mint/10 px-3 py-1.5 text-[11px] font-semibold text-mint">신청</span>
      <span
        className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
          teamClass === "done"
            ? "bg-mint/10 text-mint"
            : teamClass === "active"
              ? "bg-accent/10 text-accent-strong"
              : "bg-slate-100 text-slate-500"
        }`}
      >
        팀장
      </span>
      <span
        className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
          hrClass === "done"
            ? "bg-mint/10 text-mint"
            : hrClass === "active"
              ? "bg-accent/10 text-accent-strong"
              : "bg-slate-100 text-slate-500"
        }`}
      >
        HR
      </span>
    </div>
  );
}

export function DashboardShell() {
  const user = useAuthStore((state) => state.user)!;
  const logout = useAuthStore((state) => state.logout);

  const summary = useLeaveStore((state) => state.summary);
  const history = useLeaveStore((state) => state.history);
  const approvals = useLeaveStore((state) => state.approvals);
  const loading = useLeaveStore((state) => state.loading);
  const submitting = useLeaveStore((state) => state.submitting);
  const error = useLeaveStore((state) => state.error);
  const refresh = useLeaveStore((state) => state.refresh);
  const submitRequest = useLeaveStore((state) => state.submitRequest);
  const actOnRequest = useLeaveStore((state) => state.actOnRequest);
  const clearError = useLeaveStore((state) => state.clearError);

  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [requestOpen, setRequestOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    lastRefreshRef.current = Date.now();
    void refresh(user.id, user.role);
  }, [refresh, user.id, user.role]);

  useEffect(() => {
    function syncLatestState() {
      if (document.visibilityState === "hidden" || submitting) {
        return;
      }

      const now = Date.now();
      if (now - lastRefreshRef.current < AUTO_REFRESH_THROTTLE_MS) {
        return;
      }

      lastRefreshRef.current = now;
      void refresh(user.id, user.role);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        syncLatestState();
      }
    }

    window.addEventListener("focus", syncLatestState);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", syncLatestState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh, submitting, user.id, user.role]);

  useEffect(() => {
    if (activeTab !== "approvals" || !canApprove(user.role)) {
      return;
    }

    lastRefreshRef.current = Date.now();
    void refresh(user.id, user.role);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible" && !submitting) {
        lastRefreshRef.current = Date.now();
        void refresh(user.id, user.role);
      }
    }, APPROVAL_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, [activeTab, refresh, submitting, user.id, user.role]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const visibleTabs = useMemo(
    () => tabs.filter((tab) => (tab.key === "approvals" ? canApprove(user.role) : true)),
    [user.role],
  );

  const inFlightItems = history.filter((item) => item.status === "PENDING" || item.status === "APPROVED_LEADER");
  const approvalCounts = useMemo(
    () => ({
      requested: history.filter((item) => item.status === "PENDING").length,
      leaderApproved: history.filter((item) => item.status === "APPROVED_LEADER").length,
      finalApproved: history.filter((item) => item.status === "APPROVED_HR").length,
    }),
    [history],
  );

  async function handleRequestSubmit(payload: {
    type: LeaveType;
    startDate: string;
    endDate: string;
    reason: string;
  }) {
    const ok = await submitRequest(payload, user.id, user.role);
    if (ok) {
      setRequestOpen(false);
      setActiveTab("home");
      setToast("휴가 신청이 등록되었습니다.");
    }
  }

  async function handleApproval(payload: ApprovalActionInput) {
    const ok = await actOnRequest(payload, user.id, user.role);
    if (ok) {
      setToast(payload.action === "APPROVE" ? "결재가 반영되었습니다." : "반려가 반영되었습니다.");
    }
  }

  return (
    <div className="min-h-screen bg-backdrop px-3 py-4 text-ink sm:px-6 sm:py-8">
      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-sm flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-white/90 shadow-panel backdrop-blur">
        <div className="relative flex-1 overflow-hidden px-4 pb-28 pt-5 sm:px-5">
          <div className="pointer-events-none absolute right-0 top-0 h-56 w-56 translate-x-12 -translate-y-20 rounded-full bg-accent/15 blur-3xl" />
          <header className="relative flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-500">소중한병원 휴가관리</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{user.name} 님의 휴가 현황</h1>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-hero text-lg font-semibold text-white shadow-lg shadow-blue-600/25">
              {user.name.slice(0, 1)}
            </div>
          </header>

          <section className="relative mt-6 rounded-[1.75rem] bg-hero px-5 py-6 text-white shadow-xl shadow-blue-950/20">
            <div className="mt-4 flex items-end gap-2">
              <strong className="text-[3rem] font-semibold leading-none tracking-[-0.08em]">
                {summary ? formatNumber(summary.remaining) : "--"}
              </strong>
              <span className="pb-2 text-sm text-white/80">days remaining</span>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-white/12 p-3 backdrop-blur-sm">
                <p className="text-[11px] text-white/70">발생</p>
                <p className="mt-1 text-lg font-semibold">{summary ? formatNumber(summary.entitlement) : "--"}일</p>
              </div>
              <div className="rounded-2xl bg-white/12 p-3 backdrop-blur-sm">
                <p className="text-[11px] text-white/70">사용</p>
                <p className="mt-1 text-lg font-semibold">{summary ? formatNumber(summary.used) : "--"}일</p>
              </div>
              <div className="rounded-2xl bg-white/12 p-3 backdrop-blur-sm">
                <p className="text-[11px] text-white/70">예정</p>
                <p className="mt-1 text-lg font-semibold">{summary ? formatNumber(summary.pending) : "--"}일</p>
              </div>
            </div>
          </section>

          {error ? (
            <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
              <div className="flex items-center justify-between gap-3">
                <span>{error}</span>
                <button type="button" className="font-semibold" onClick={clearError}>
                  닫기
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            <article className="flex min-h-[156px] flex-col justify-between rounded-[1.6rem] border border-white/70 bg-white/85 p-4 shadow-card">
              <div>
                <p className="text-xs font-medium text-slate-400">빠른 실행</p>
                <h2 className="mt-2 text-lg font-semibold tracking-tight text-ink">휴가 신청</h2>
              </div>
              <button
                type="button"
                className="mt-4 w-full rounded-2xl bg-hero px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20"
                onClick={() => setRequestOpen(true)}
              >
                새 신청 작성
              </button>
            </article>

            <article className="rounded-[1.6rem] border border-white/70 bg-white/85 p-4 shadow-card">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold tracking-tight text-ink">승인 현황</h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                  {inFlightItems.length}건 진행
                </span>
              </div>
              <div className="mt-4 grid gap-2.5">
                <div className="flex items-center justify-between rounded-2xl border border-mint/20 bg-mint/10 px-3 py-3">
                  <div>
                    <p className="text-[11px] font-medium text-mint">신청</p>
                    <p className="mt-1 text-sm font-semibold text-ink">접수 완료</p>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-semibold text-mint">
                    {approvalCounts.requested}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-accent/20 bg-accent/10 px-3 py-3">
                  <div>
                    <p className="text-[11px] font-medium text-accent-strong">팀장</p>
                    <p className="mt-1 text-sm font-semibold text-ink">1차 승인</p>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-semibold text-accent-strong">
                    {approvalCounts.leaderApproved}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">HR</p>
                    <p className="mt-1 text-sm font-semibold text-ink">최종 승인</p>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-600">
                    {approvalCounts.finalApproved}
                  </span>
                </div>
              </div>
            </article>
          </div>

          {activeTab === "home" ? (
            <section className="mt-6 space-y-6">
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold tracking-tight text-ink">진행 중인 승인</h2>
                  <button
                    type="button"
                    className="text-sm font-medium text-accent-strong"
                    onClick={() => setActiveTab("history")}
                  >
                    전체 내역
                  </button>
                </div>
                <div className="space-y-3">
                  {inFlightItems.length ? (
                    inFlightItems.map((item) => (
                      <article key={item.id} className="rounded-[1.5rem] border border-white/70 bg-white/90 p-4 shadow-card">
                        <div className="flex items-start gap-3">
                          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-mint/10 text-lg text-mint">
                            {item.type === "HALF_AM" || item.type === "HALF_PM" ? "◐" : "✓"}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h3 className="text-sm font-semibold text-ink">
                                  {typeLabel(item.type)} · {formatNumber(item.amount)}일
                                </h3>
                                <p className="mt-1 text-sm text-slate-500">
                                  {formatDateRange(item)} · {item.reason}
                                </p>
                              </div>
                              <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${statusClass(item.status)}`}>
                                {statusLabel(item.status)}
                              </span>
                            </div>
                            <StepPills status={item.status} />
                          </div>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-white/85 px-4 py-6 text-center text-sm text-slate-500">
                      현재 진행 중인 휴가 신청이 없습니다.
                    </div>
                  )}
                </div>
              </div>

            </section>
          ) : null}

          {activeTab === "history" ? (
            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold tracking-tight text-ink">신청 이력</h2>
                {loading ? <span className="text-xs text-slate-400">새로고침 중...</span> : null}
              </div>
              <div className="space-y-3">
                {history.map((item) => (
                  <article key={item.id} className="rounded-[1.5rem] border border-white/70 bg-white/90 p-4 shadow-card">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-ink">{typeLabel(item.type)}</h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {formatDateRange(item)} · {formatNumber(item.amount)}일
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-500">{item.reason}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${statusClass(item.status)}`}>
                        {statusLabel(item.status)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {activeTab === "approvals" && canApprove(user.role) ? (
            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold tracking-tight text-ink">승인 대기함</h2>
                {loading ? <span className="text-xs text-slate-400">새로고침 중...</span> : null}
              </div>
              <div className="space-y-3">
                {approvals.length ? (
                  approvals.map((item) => (
                    <article key={item.id} className="rounded-[1.5rem] border border-white/70 bg-white/90 p-4 shadow-card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-ink">
                            {item.employeeName} · {typeLabel(item.type)}
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            {item.employeeNo} · {item.teamName}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {formatDateRange(item)} · {formatNumber(item.amount)}일
                          </p>
                          <p className="mt-2 text-sm leading-6 text-slate-500">{item.reason}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${statusClass(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          className="flex-1 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600"
                          onClick={() => void handleApproval({ requestId: item.id, action: "REJECT" })}
                          disabled={submitting}
                        >
                          반려
                        </button>
                        <button
                          type="button"
                          className="flex-1 rounded-2xl bg-accent/10 px-4 py-3 text-sm font-semibold text-accent-strong"
                          onClick={() => void handleApproval({ requestId: item.id, action: "APPROVE" })}
                          disabled={submitting}
                        >
                          승인
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-white/85 px-4 py-6 text-center text-sm text-slate-500">
                    현재 처리할 승인 건이 없습니다.
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {activeTab === "profile" ? (
            <section className="mt-6 space-y-3">
              <article className="rounded-[1.5rem] border border-white/70 bg-white/90 p-4 shadow-card">
                <h2 className="text-base font-semibold tracking-tight text-ink">내 정보</h2>
                <div className="mt-4 space-y-3 text-sm text-slate-500">
                  <div className="flex items-center justify-between gap-3">
                    <span>사번</span>
                    <span className="font-semibold text-ink">{user.employeeNo}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>권한</span>
                    <span className="font-semibold text-ink">{user.role}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>소속</span>
                    <span className="text-right font-semibold text-ink">{user.orgPath.join(" > ")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>입사일</span>
                    <span className="font-semibold text-ink">{user.joinedAt}</span>
                  </div>
                </div>
              </article>
              <button
                type="button"
                className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                onClick={() => void logout()}
              >
                로그아웃
              </button>
            </section>
          ) : null}
        </div>

        <nav className="absolute inset-x-3 bottom-3 grid grid-cols-4 gap-2 rounded-[1.6rem] border border-white/70 bg-white/92 p-2 shadow-lg shadow-slate-900/10 backdrop-blur sm:left-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`rounded-2xl px-2 py-2.5 text-center ${
                activeTab === tab.key ? "bg-accent/10 text-accent-strong" : "text-slate-400"
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              <span className="block text-xs font-semibold">{tab.ko}</span>
              <span className="mt-1 block text-[11px]">{tab.en}</span>
            </button>
          ))}
        </nav>
      </div>

      <RequestModal
        open={requestOpen}
        submitting={submitting}
        onClose={() => setRequestOpen(false)}
        onSubmit={handleRequestSubmit}
      />

      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-slate-950 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
