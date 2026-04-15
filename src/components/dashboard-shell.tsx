import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  getApprovalRouteLabel,
  getApprovalStages,
  getApprovedStage,
  getLeaveStatusLabel,
  getNextPendingStage,
  getStageLabel,
  isFinalApprovedStatus,
  isInFlightStatus,
} from "../lib/approval-flow";
import { BrandMark } from "./brand-mark";
import { RequestModal } from "./request-modal";
import { useAuthStore } from "../stores/auth-store";
import { useLeaveStore } from "../stores/leave-store";
import type { ApprovalActionInput, LeaveRequestItem, LeaveType, NoticeItem, UserRole } from "../types";

type TabKey = "home" | "history" | "approvals" | "profile";

const AUTO_REFRESH_THROTTLE_MS = 3000;
const APPROVAL_POLL_MS = 60000;
const ONE_STEP_URL = "https://docs.google.com/forms/d/1qPrhTSkEeb57nMpXtLtzGkOjSo68mom49RPvyb_g5AM/edit";

const tabs: Array<{ key: TabKey; ko: string; en: string }> = [
  { key: "home", ko: "홈", en: "Overview" },
  { key: "history", ko: "연차 내역", en: "History" },
  { key: "approvals", ko: "승인함", en: "Approvals" },
  { key: "profile", ko: "프로필", en: "Profile" },
];

const typeMap: Record<LeaveType, string> = {
  ANNUAL: "연차",
  HALF_AM: "반차(오전)",
  HALF_PM: "반차(오후)",
  SICK: "병가",
};

function roleLabel(role: UserRole) {
  return { USER: "직원", LEADER: "팀장", HR: "인사", ADMIN: "관리자", DIRECTOR: "원장" }[role];
}

function canApprove(role: UserRole) {
  return role === "LEADER" || role === "HR" || role === "ADMIN" || role === "DIRECTOR";
}

function canManageNotices(role: UserRole) {
  return role !== "USER";
}

function formatNumber(value: number) {
  return value.toFixed(1);
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(date: string) {
  return new Date(date).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDateRange(item: LeaveRequestItem) {
  return item.startDate === item.endDate ? formatDate(item.startDate) : `${formatDate(item.startDate)} - ${formatDate(item.endDate)}`;
}

function statusClass(item: LeaveRequestItem) {
  if (item.status === "REJECTED") return "bg-rose-50 text-rose-600";
  if (isFinalApprovedStatus(item.requesterRole, item.requesterHasLeader, item.status)) return "bg-mint/12 text-mint";
  if (item.status === "PENDING") return "bg-amber-50 text-amber-700";
  return "bg-accent/10 text-accent-strong";
}

function searchText(item: LeaveRequestItem) {
  return [
    item.employeeName,
    item.employeeNo,
    item.teamName,
    item.reason,
    typeMap[item.type],
    roleLabel(item.requesterRole),
    getApprovalRouteLabel(item.requesterRole, item.requesterHasLeader),
  ]
    .join(" ")
    .toLowerCase();
}

function downloadHistoryCsv(rows: LeaveRequestItem[]) {
  const head = ["신청일시", "신청자", "사번", "권한", "팀", "휴가유형", "시작일", "종료일", "차감일수", "결재선", "상태", "사유"];
  const body = rows.map((item) => [
    item.createdAt,
    item.employeeName,
    item.employeeNo,
    roleLabel(item.requesterRole),
    item.teamName,
    typeMap[item.type],
    item.startDate,
    item.endDate,
    item.amount.toString(),
    getApprovalRouteLabel(item.requesterRole, item.requesterHasLeader),
    getLeaveStatusLabel(item.requesterRole, item.requesterHasLeader, item.status),
    item.reason.replace(/\r?\n/g, " "),
  ]);
  const csv = [head, ...body].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `leave-history-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  window.URL.revokeObjectURL(url);
}

function StepPills({ item }: { item: LeaveRequestItem }) {
  const stages = getApprovalStages(item.requesterRole, item.requesterHasLeader);
  const approvedStage = getApprovedStage(item.status);
  const approvedIndex = approvedStage ? stages.indexOf(approvedStage) : -1;
  const nextStage = getNextPendingStage(item.requesterRole, item.requesterHasLeader, item.status);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="rounded-full bg-brand-slate/10 px-3 py-1 text-[11px] font-semibold text-brand-slate">신청</span>
      {stages.map((stage, index) => {
        const done = item.status !== "REJECTED" && index <= approvedIndex;
        const active = item.status !== "REJECTED" && nextStage === stage;
        const classes = done ? "bg-mint/12 text-mint" : active ? "bg-accent/10 text-accent-strong" : "bg-slate-100 text-slate-500";
        return (
          <span key={stage} className={`rounded-full px-3 py-1 text-[11px] font-semibold ${classes}`}>
            {getStageLabel(stage)}
          </span>
        );
      })}
    </div>
  );
}

function NoticeCard({ item }: { item: NoticeItem }) {
  return (
    <article className="rounded-[1.6rem] border border-white/70 bg-white/90 p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-slate/55">Notice</p>
          <h3 className="mt-2 text-lg font-semibold text-ink">{item.title}</h3>
        </div>
        <span className="rounded-full bg-brand-slate/10 px-3 py-1 text-[11px] font-semibold text-brand-slate">{roleLabel(item.authorRole)}</span>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{item.content}</p>
      <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
        <span>{item.authorName}</span>
        <span>{formatDateTime(item.createdAt)}</span>
      </div>
    </article>
  );
}

export function DashboardShell() {
  const user = useAuthStore((state) => state.user)!;
  const logout = useAuthStore((state) => state.logout);
  const { summary, history, approvals, notices, loading, submitting, postingNotice, error, refresh, submitRequest, actOnRequest, createNotice, clearError } =
    useLeaveStore();
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [requestOpen, setRequestOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [approvalSearch, setApprovalSearch] = useState("");
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeContent, setNoticeContent] = useState("");
  const [filters, setFilters] = useState({ query: "", status: "ALL", type: "ALL", route: "ALL", from: "", to: "" });
  const deferredQuery = useDeferredValue(filters.query);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    lastRefreshRef.current = Date.now();
    void refresh(user.id, user.role);
  }, [refresh, user.id, user.role]);

  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === "hidden" || submitting || postingNotice) return;
      const now = Date.now();
      if (now - lastRefreshRef.current < AUTO_REFRESH_THROTTLE_MS) return;
      lastRefreshRef.current = now;
      void refresh(user.id, user.role);
    };
    const onVisible = () => document.visibilityState === "visible" && sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [postingNotice, refresh, submitting, user.id, user.role]);

  useEffect(() => {
    if (activeTab !== "approvals" || !canApprove(user.role)) return;
    lastRefreshRef.current = Date.now();
    void refresh(user.id, user.role);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible" && !submitting) {
        lastRefreshRef.current = Date.now();
        void refresh(user.id, user.role);
      }
    }, APPROVAL_POLL_MS);
    return () => window.clearInterval(id);
  }, [activeTab, refresh, submitting, user.id, user.role]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const visibleTabs = useMemo(() => tabs.filter((tab) => (tab.key === "approvals" ? canApprove(user.role) : true)), [user.role]);
  const inFlight = useMemo(() => history.filter((item) => isInFlightStatus(item.requesterRole, item.requesterHasLeader, item.status)), [history]);
  const routeOptions = useMemo(
    () => ["ALL", ...Array.from(new Set(history.map((item) => getApprovalRouteLabel(item.requesterRole, item.requesterHasLeader))))],
    [history],
  );
  const filteredHistory = useMemo(
    () =>
      history.filter((item) => {
        const route = getApprovalRouteLabel(item.requesterRole, item.requesterHasLeader);
        const status = getLeaveStatusLabel(item.requesterRole, item.requesterHasLeader, item.status);
        return (
          (!deferredQuery || searchText(item).includes(deferredQuery.toLowerCase())) &&
          (filters.status === "ALL" || status === filters.status) &&
          (filters.type === "ALL" || item.type === filters.type) &&
          (filters.route === "ALL" || route === filters.route) &&
          (!filters.from || item.startDate >= filters.from) &&
          (!filters.to || item.endDate <= filters.to)
        );
      }),
    [deferredQuery, filters, history],
  );
  const filteredApprovals = useMemo(
    () => (!approvalSearch ? approvals : approvals.filter((item) => searchText(item).includes(approvalSearch.toLowerCase()))),
    [approvalSearch, approvals],
  );

  const counts = useMemo(
    () => ({
      received: history.filter((item) => item.status === "PENDING").length,
      progressing: history.filter((item) => item.status !== "PENDING" && item.status !== "REJECTED" && !isFinalApprovedStatus(item.requesterRole, item.requesterHasLeader, item.status)).length,
      final: history.filter((item) => isFinalApprovedStatus(item.requesterRole, item.requesterHasLeader, item.status)).length,
    }),
    [history],
  );

  async function handleApproval(payload: ApprovalActionInput) {
    const ok = await actOnRequest(payload, user.id, user.role);
    if (ok) setToast(payload.action === "APPROVE" ? "결재가 반영되었습니다." : "반려가 반영되었습니다.");
  }

  async function handleNoticeSubmit() {
    if (!noticeTitle.trim() || !noticeContent.trim()) return;
    const ok = await createNotice({ title: noticeTitle.trim(), content: noticeContent.trim() }, user.id, user.role);
    if (ok) {
      setNoticeTitle("");
      setNoticeContent("");
      setToast("공지사항이 등록되었습니다.");
    }
  }

  return (
    <div className="min-h-screen bg-backdrop px-4 py-6 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 px-5 py-5 shadow-panel backdrop-blur sm:px-7">
          <div className="pointer-events-none absolute -right-6 -top-8 h-44 w-44 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <BrandMark compact />
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-[1.4rem] bg-mist px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-slate/55">{roleLabel(user.role)}</p>
                <p className="mt-1 text-base font-semibold text-ink">{user.name} · {user.employeeNo}</p>
                <p className="mt-1 text-sm text-slate-500">{user.teamName || user.orgPath.at(-1) || "소속 미지정"}</p>
              </div>
              <button type="button" className="rounded-2xl bg-brand-slate px-4 py-3 text-sm font-semibold text-white" onClick={() => void logout()}>
                로그아웃
              </button>
            </div>
          </div>
        </header>

        <nav className="mt-4 flex flex-wrap gap-2">
          {visibleTabs.map((tab) => (
            <button key={tab.key} type="button" className={`rounded-full px-4 py-2.5 text-sm font-semibold ${activeTab === tab.key ? "bg-brand-slate text-white" : "bg-white/90 text-slate-500 shadow-card"}`} onClick={() => setActiveTab(tab.key)}>
              {tab.ko}
              <span className="ml-2 text-xs opacity-75">{tab.en}</span>
            </button>
          ))}
        </nav>

        {error ? (
          <div className="mt-4 rounded-[1.5rem] border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <div className="flex items-center justify-between gap-3">
              <span>{error}</span>
              <button type="button" className="font-semibold" onClick={clearError}>닫기</button>
            </div>
          </div>
        ) : null}

        {activeTab === "home" ? (
          <section className="mt-5 space-y-5">
            <div className="grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
              <article className="rounded-[2rem] bg-hero px-6 py-6 text-white shadow-panel">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/70">Leave Dashboard</p>
                <h2 className="mt-3 text-[2rem] font-semibold tracking-tight">청록 톤으로 정리된 연차·공지 관리 화면</h2>
                <p className="mt-3 text-sm leading-7 text-white/82">팀원 연차는 팀장 → 인사, 팀장 연차는 인사 → 원장 흐름으로 처리됩니다.</p>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[1.5rem] bg-white/12 p-4"><p className="text-xs text-white/70">잔여</p><p className="mt-2 text-3xl font-semibold">{summary ? formatNumber(summary.remaining) : "--"}</p></div>
                  <div className="rounded-[1.5rem] bg-white/12 p-4"><p className="text-xs text-white/70">사용</p><p className="mt-2 text-3xl font-semibold">{summary ? formatNumber(summary.used) : "--"}</p></div>
                  <div className="rounded-[1.5rem] bg-white/12 p-4"><p className="text-xs text-white/70">예정</p><p className="mt-2 text-3xl font-semibold">{summary ? formatNumber(summary.pending) : "--"}</p></div>
                </div>
              </article>

              <div className="grid gap-4">
                <article className="rounded-[1.8rem] border border-white/70 bg-white/90 p-5 shadow-card">
                  <h3 className="text-lg font-semibold text-ink">빠른 실행</h3>
                  <div className="mt-4 grid gap-3">
                    <button type="button" className="rounded-[1.4rem] bg-brand-slate px-4 py-4 text-left text-white" onClick={() => setRequestOpen(true)}>
                      <span className="block text-sm font-semibold">새 연차 신청</span>
                      <span className="mt-1 block text-sm text-white/78">일정과 사유를 바로 등록합니다.</span>
                    </button>
                    <a href={ONE_STEP_URL} target="_blank" rel="noreferrer" className="rounded-[1.4rem] border border-accent/15 bg-accent/10 px-4 py-4 text-left">
                      <span className="block text-sm font-semibold text-accent-strong">원스텝 제안 남기기</span>
                      <span className="mt-1 block text-sm text-slate-600">Google Form으로 연결됩니다.</span>
                    </a>
                  </div>
                </article>

                <article className="rounded-[1.8rem] border border-white/70 bg-white/90 p-5 shadow-card">
                  <h3 className="text-lg font-semibold text-ink">승인 현황</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[1.2rem] bg-mist px-4 py-3"><p className="text-xs text-slate-500">접수</p><p className="mt-2 text-2xl font-semibold">{counts.received}</p></div>
                    <div className="rounded-[1.2rem] bg-accent/10 px-4 py-3"><p className="text-xs text-accent-strong">진행</p><p className="mt-2 text-2xl font-semibold text-accent-strong">{counts.progressing}</p></div>
                    <div className="rounded-[1.2rem] bg-mint/12 px-4 py-3"><p className="text-xs text-mint">최종 승인</p><p className="mt-2 text-2xl font-semibold text-mint">{counts.final}</p></div>
                  </div>
                </article>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold tracking-tight text-ink">공지사항</h2>
                  <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-500 shadow-card">최근 {notices.length}건</span>
                </div>
                {canManageNotices(user.role) ? (
                  <article className="rounded-[1.8rem] border border-white/70 bg-white/90 p-5 shadow-card">
                    <p className="text-sm text-slate-500">이모지와 줄바꿈을 그대로 사용할 수 있습니다.</p>
                    <div className="mt-4 grid gap-3">
                      <input value={noticeTitle} onChange={(e) => setNoticeTitle(e.target.value)} placeholder="예: 📢 검진센터 운영 안내" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10" />
                      <textarea rows={4} value={noticeContent} onChange={(e) => setNoticeContent(e.target.value)} placeholder="공지 내용 입력" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10" />
                      <button type="button" disabled={postingNotice} className="rounded-2xl bg-hero px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" onClick={() => void handleNoticeSubmit()}>
                        {postingNotice ? "등록 중..." : "공지 등록"}
                      </button>
                    </div>
                  </article>
                ) : null}
                <div className="grid gap-4">
                  {notices.length ? (
                    notices.map((item) => <NoticeCard key={item.id} item={item} />)
                  ) : (
                    <div className="rounded-[1.6rem] border border-dashed border-slate-200 bg-white/90 px-4 py-7 text-center text-sm text-slate-500">
                      아직 등록된 공지사항이 없습니다.
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold tracking-tight text-ink">진행 중인 신청</h2>
                  <button type="button" className="text-sm font-semibold text-accent-strong" onClick={() => setActiveTab("history")}>내역 보기</button>
                </div>
                <div className="grid gap-3">
                  {inFlight.length ? inFlight.map((item) => (
                    <article key={item.id} className="rounded-[1.6rem] border border-white/70 bg-white/90 p-4 shadow-card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full bg-brand-slate/10 px-3 py-1 text-[11px] font-semibold text-brand-slate">{typeMap[item.type]}</span>
                            <span className="rounded-full bg-mist px-3 py-1 text-[11px] font-semibold text-slate-500">{getApprovalRouteLabel(item.requesterRole, item.requesterHasLeader)}</span>
                          </div>
                          <h3 className="mt-3 text-base font-semibold text-ink">{item.employeeName} · {formatNumber(item.amount)}일</h3>
                          <p className="mt-1 text-sm text-slate-500">{formatDateRange(item)}</p>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{item.reason}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${statusClass(item)}`}>{getLeaveStatusLabel(item.requesterRole, item.requesterHasLeader, item.status)}</span>
                      </div>
                      <StepPills item={item} />
                    </article>
                  )) : <div className="rounded-[1.6rem] border border-dashed border-slate-200 bg-white/90 px-4 py-7 text-center text-sm text-slate-500">현재 진행 중인 신청이 없습니다.</div>}
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {activeTab === "history" ? (
          <section className="mt-5 space-y-4">
            <article className="rounded-[1.8rem] border border-white/70 bg-white/90 p-5 shadow-card">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <h2 className="text-xl font-semibold tracking-tight text-ink">연차 내역 필터</h2>
                <button type="button" disabled={!filteredHistory.length} className="rounded-full bg-brand-slate px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" onClick={() => downloadHistoryCsv(filteredHistory)}>엑셀 다운로드 (.csv)</button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <input value={filters.query} onChange={(e) => setFilters((c) => ({ ...c, query: e.target.value }))} placeholder="이름, 사번, 사유 검색" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10 xl:col-span-2" />
                <select value={filters.status} onChange={(e) => setFilters((c) => ({ ...c, status: e.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10">
                  <option value="ALL">전체 상태</option><option value="팀장 승인 대기">팀장 승인 대기</option><option value="인사 승인 대기">인사 승인 대기</option><option value="원장 승인 대기">원장 승인 대기</option><option value="최종 승인">최종 승인</option><option value="반려">반려</option>
                </select>
                <select value={filters.type} onChange={(e) => setFilters((c) => ({ ...c, type: e.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10">
                  <option value="ALL">전체 유형</option><option value="ANNUAL">연차</option><option value="HALF_AM">반차(오전)</option><option value="HALF_PM">반차(오후)</option><option value="SICK">병가</option>
                </select>
                <select value={filters.route} onChange={(e) => setFilters((c) => ({ ...c, route: e.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10">
                  {routeOptions.map((option) => <option key={option} value={option}>{option === "ALL" ? "전체 결재선" : option}</option>)}
                </select>
                <input type="date" value={filters.from} onChange={(e) => setFilters((c) => ({ ...c, from: e.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10" />
                <input type="date" value={filters.to} onChange={(e) => setFilters((c) => ({ ...c, to: e.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10" />
              </div>
            </article>
            <div className="text-sm font-semibold text-slate-500">총 {filteredHistory.length}건{loading ? " · 새로고침 중..." : ""}</div>
            <div className="grid gap-3">
              {filteredHistory.length ? filteredHistory.map((item) => (
                <article key={item.id} className="rounded-[1.7rem] border border-white/70 bg-white/90 p-5 shadow-card">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-brand-slate/10 px-3 py-1 text-[11px] font-semibold text-brand-slate">{item.employeeName} · {roleLabel(item.requesterRole)}</span>
                        <span className="rounded-full bg-mist px-3 py-1 text-[11px] font-semibold text-slate-500">{item.employeeNo} · {item.teamName}</span>
                        <span className="rounded-full bg-accent/10 px-3 py-1 text-[11px] font-semibold text-accent-strong">{getApprovalRouteLabel(item.requesterRole, item.requesterHasLeader)}</span>
                      </div>
                      <h3 className="mt-3 text-lg font-semibold text-ink">{typeMap[item.type]} · {formatNumber(item.amount)}일</h3>
                      <p className="mt-1 text-sm text-slate-500">{formatDateRange(item)} · 신청 {formatDateTime(item.createdAt)}</p>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{item.reason}</p>
                    </div>
                    <div className="lg:text-right">
                      <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ${statusClass(item)}`}>{getLeaveStatusLabel(item.requesterRole, item.requesterHasLeader, item.status)}</span>
                      <StepPills item={item} />
                    </div>
                  </div>
                </article>
              )) : <div className="rounded-[1.6rem] border border-dashed border-slate-200 bg-white/90 px-4 py-8 text-center text-sm text-slate-500">필터 조건에 맞는 내역이 없습니다.</div>}
            </div>
          </section>
        ) : null}

        {activeTab === "approvals" && canApprove(user.role) ? (
          <section className="mt-5 space-y-4">
            <article className="rounded-[1.8rem] border border-white/70 bg-white/90 p-5 shadow-card">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <h2 className="text-xl font-semibold tracking-tight text-ink">승인 대기함</h2>
                <input value={approvalSearch} onChange={(e) => setApprovalSearch(e.target.value)} placeholder="이름, 사번, 사유 검색" className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10 md:max-w-sm" />
              </div>
            </article>
            <div className="grid gap-3">
              {filteredApprovals.length ? filteredApprovals.map((item) => (
                <article key={item.id} className="rounded-[1.7rem] border border-white/70 bg-white/90 p-5 shadow-card">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-brand-slate/10 px-3 py-1 text-[11px] font-semibold text-brand-slate">{item.employeeName}</span>
                        <span className="rounded-full bg-mist px-3 py-1 text-[11px] font-semibold text-slate-500">{item.employeeNo} · {item.teamName}</span>
                        <span className="rounded-full bg-accent/10 px-3 py-1 text-[11px] font-semibold text-accent-strong">{getApprovalRouteLabel(item.requesterRole, item.requesterHasLeader)}</span>
                      </div>
                      <h3 className="mt-3 text-lg font-semibold text-ink">{typeMap[item.type]} · {formatNumber(item.amount)}일</h3>
                      <p className="mt-1 text-sm text-slate-500">{formatDateRange(item)}</p>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{item.reason}</p>
                      <StepPills item={item} />
                    </div>
                    <div className="flex min-w-[220px] flex-col gap-3">
                      <span className={`inline-flex self-start rounded-full px-3 py-1 text-[11px] font-semibold ${statusClass(item)}`}>{getLeaveStatusLabel(item.requesterRole, item.requesterHasLeader, item.status)}</span>
                      <button type="button" className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600" onClick={() => void handleApproval({ requestId: item.id, action: "REJECT" })} disabled={submitting}>반려</button>
                      <button type="button" className="rounded-2xl bg-hero px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" onClick={() => void handleApproval({ requestId: item.id, action: "APPROVE" })} disabled={submitting}>승인</button>
                    </div>
                  </div>
                </article>
              )) : <div className="rounded-[1.6rem] border border-dashed border-slate-200 bg-white/90 px-4 py-8 text-center text-sm text-slate-500">현재 처리할 승인 건이 없습니다.</div>}
            </div>
          </section>
        ) : null}

        {activeTab === "profile" ? (
          <section className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <article className="rounded-[1.8rem] border border-white/70 bg-white/90 p-6 shadow-card">
              <h2 className="text-xl font-semibold tracking-tight text-ink">내 정보</h2>
              <div className="mt-5 space-y-4 text-sm text-slate-500">
                <div className="flex items-center justify-between gap-3"><span>이름</span><span className="font-semibold text-ink">{user.name}</span></div>
                <div className="flex items-center justify-between gap-3"><span>사번</span><span className="font-semibold text-ink">{user.employeeNo}</span></div>
                <div className="flex items-center justify-between gap-3"><span>권한</span><span className="font-semibold text-ink">{roleLabel(user.role)}</span></div>
                <div className="flex items-center justify-between gap-3"><span>소속</span><span className="text-right font-semibold text-ink">{user.orgPath.join(" > ")}</span></div>
                <div className="flex items-center justify-between gap-3"><span>입사일</span><span className="font-semibold text-ink">{user.joinedAt}</span></div>
              </div>
            </article>
            <article className="rounded-[1.8rem] border border-white/70 bg-white/90 p-6 shadow-card">
              <h2 className="text-xl font-semibold tracking-tight text-ink">결재선 안내</h2>
              <div className="mt-5 grid gap-3">
                <div className="rounded-[1.4rem] bg-mist p-4"><p className="text-sm font-semibold text-ink">팀원 연차</p><p className="mt-2 text-sm leading-7 text-slate-600">팀원 → 팀장 → 인사</p></div>
                <div className="rounded-[1.4rem] bg-accent/10 p-4"><p className="text-sm font-semibold text-accent-strong">팀장 연차</p><p className="mt-2 text-sm leading-7 text-slate-600">팀장 → 인사 → 원장</p></div>
                <div className="rounded-[1.4rem] bg-white p-4 ring-1 ring-slate-100"><p className="text-sm font-semibold text-ink">원스텝 제안</p><p className="mt-2 text-sm leading-7 text-slate-600">홈 화면에서 바로 Google Form으로 이동할 수 있습니다.</p></div>
              </div>
            </article>
          </section>
        ) : null}
      </div>

      <RequestModal open={requestOpen} submitting={submitting} onClose={() => setRequestOpen(false)} onSubmit={async (payload) => {
        const ok = await submitRequest(payload, user.id, user.role);
        if (ok) {
          setRequestOpen(false);
          setActiveTab("home");
          setToast("연차 신청이 등록되었습니다.");
        }
      }} userRole={user.role} />

      {toast ? <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-brand-slate px-4 py-2 text-sm text-white shadow-lg shadow-brand-slate/20">{toast}</div> : null}
    </div>
  );
}
