import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
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
type HistoryFilterKey = "ALL" | "IN_FLIGHT" | "APPROVED" | "REJECTED";

const AUTO_REFRESH_THROTTLE_MS = 3000;
const APPROVAL_POLL_MS = 60000;
const ONE_STEP_URL = "https://docs.google.com/forms/d/1qPrhTSkEeb57nMpXtLtzGkOjSo68mom49RPvyb_g5AM/edit";
const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "home", label: "홈" },
  { key: "history", label: "내역" },
  { key: "approvals", label: "승인" },
  { key: "profile", label: "프로필" },
];
const historyFilters: Array<{ key: HistoryFilterKey; label: string }> = [
  { key: "ALL", label: "전체" },
  { key: "IN_FLIGHT", label: "진행중" },
  { key: "APPROVED", label: "승인" },
  { key: "REJECTED", label: "반려" },
];
const typeMap: Record<LeaveType, string> = { ANNUAL: "연차", HALF_AM: "반차 오전", HALF_PM: "반차 오후", SICK: "병가" };

const roleLabel = (role: UserRole) => ({ USER: "직원", LEADER: "팀장", HR: "인사", ADMIN: "관리자", DIRECTOR: "원장" }[role]);
const canApprove = (role: UserRole) => ["LEADER", "HR", "ADMIN", "DIRECTOR"].includes(role);
const canWriteNotice = (role: UserRole) => role === "HR" || role === "DIRECTOR";
const formatNumber = (value: number) => value.toFixed(1);
const formatDate = (date: string) => new Date(date).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
const formatDateTime = (date: string) => new Date(date).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const formatDateRange = (item: LeaveRequestItem) =>
  item.startDate === item.endDate ? formatDate(item.startDate) : `${formatDate(item.startDate)} - ${formatDate(item.endDate)}`;
const getRouteSummary = (role: UserRole, hasLeader: boolean) => (role === "LEADER" ? "팀장 → 인사 → 원장" : hasLeader ? "팀원 → 팀장 → 인사" : "직원 → 인사");
const routeOf = (item: LeaveRequestItem) => getRouteSummary(item.requesterRole, item.requesterHasLeader);

function searchText(item: LeaveRequestItem) {
  return [item.employeeName, item.employeeNo, item.teamName, item.reason, typeMap[item.type], roleLabel(item.requesterRole), routeOf(item), getLeaveStatusLabel(item.requesterRole, item.requesterHasLeader, item.status)]
    .join(" ")
    .toLowerCase();
}

function statusClasses(item: LeaveRequestItem) {
  if (item.status === "REJECTED") return "bg-rose-50 text-rose-600";
  if (isFinalApprovedStatus(item.requesterRole, item.requesterHasLeader, item.status)) return "bg-mint/12 text-mint";
  if (item.status === "PENDING") return "bg-amber-50 text-amber-700";
  return "bg-accent/10 text-accent-strong";
}

function matchHistoryFilter(item: LeaveRequestItem, filter: HistoryFilterKey) {
  if (filter === "ALL") return true;
  if (filter === "REJECTED") return item.status === "REJECTED";
  if (filter === "APPROVED") return isFinalApprovedStatus(item.requesterRole, item.requesterHasLeader, item.status);
  return isInFlightStatus(item.requesterRole, item.requesterHasLeader, item.status);
}

function downloadHistoryCsv(rows: LeaveRequestItem[]) {
  const head = ["신청일시", "이름", "사번", "권한", "소속", "휴가유형", "시작일", "종료일", "차감일수", "전결", "상태", "사유"];
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
    routeOf(item),
    getLeaveStatusLabel(item.requesterRole, item.requesterHasLeader, item.status),
    item.reason.replace(/\r?\n/g, " "),
  ]);
  const csv = [head, ...body].map((row) => row.map((value) => `"${String(value).replace(/"/g, "\"\"")}"`).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `leave-history-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  window.URL.revokeObjectURL(url);
}

function StageTrack({ item }: { item: LeaveRequestItem }) {
  const stages = getApprovalStages(item.requesterRole, item.requesterHasLeader);
  const approvedStage = getApprovedStage(item.status);
  const approvedIndex = approvedStage ? stages.indexOf(approvedStage) : -1;
  const nextStage = getNextPendingStage(item.requesterRole, item.requesterHasLeader, item.status);

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <span className="rounded-full bg-brand-slate px-3 py-1 text-[11px] font-semibold text-white">신청</span>
      {stages.map((stage, index) => {
        const done = item.status !== "REJECTED" && index <= approvedIndex;
        const active = item.status !== "REJECTED" && nextStage === stage;
        const className = done ? "bg-mint/12 text-mint" : active ? "bg-accent/10 text-accent-strong" : "bg-slate-100 text-slate-500";
        return (
          <span key={stage} className={`rounded-full px-3 py-1 text-[11px] font-semibold ${className}`}>
            {getStageLabel(stage)}
          </span>
        );
      })}
    </div>
  );
}

function RequestCard({
  item,
  heading,
  subheading,
  meta,
  actionSlot,
}: {
  item: LeaveRequestItem;
  heading: string;
  subheading: string;
  meta?: string;
  actionSlot?: ReactNode;
}) {
  return (
    <article className="rounded-[1.6rem] border border-white/70 bg-white/92 p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-brand-slate/10 px-3 py-1 text-[11px] font-semibold text-brand-slate">{typeMap[item.type]}</span>
            <span className="rounded-full bg-mist px-3 py-1 text-[11px] font-semibold text-slate-500">{formatNumber(item.amount)}일</span>
            {meta ? <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">{meta}</span> : null}
          </div>
          <h3 className="mt-3 text-base font-semibold text-ink">{heading}</h3>
          <p className="mt-1 text-sm text-slate-500">{subheading}</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.reason}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${statusClasses(item)}`}>
          {getLeaveStatusLabel(item.requesterRole, item.requesterHasLeader, item.status)}
        </span>
      </div>
      <StageTrack item={item} />
      {actionSlot ? <div className="mt-4">{actionSlot}</div> : null}
    </article>
  );
}

const NoticeCard = ({ notice }: { notice: NoticeItem }) => (
  <article className="rounded-[1.6rem] border border-white/70 bg-white/92 p-4 shadow-card">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-base font-semibold text-ink">{notice.title}</h3>
      <span className="rounded-full bg-mist px-3 py-1 text-[11px] font-semibold text-slate-500">{roleLabel(notice.authorRole)}</span>
    </div>
    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{notice.content}</p>
    <p className="mt-3 text-xs text-slate-400">{notice.authorName} · {formatDateTime(notice.createdAt)}</p>
  </article>
);

const EmptyState = ({ label }: { label: string }) => (
  <div className="rounded-[1.6rem] border border-dashed border-slate-200 bg-white/88 px-4 py-8 text-center text-sm text-slate-500">{label}</div>
);

export function DashboardShell() {
  const user = useAuthStore((state) => state.user)!;
  const logout = useAuthStore((state) => state.logout);
  const { summary, history, approvals, notices, loading, submitting, postingNotice, error, refresh, submitRequest, actOnRequest, createNotice, clearError } =
    useLeaveStore();

  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [requestOpen, setRequestOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterKey>("ALL");
  const [routeFilter, setRouteFilter] = useState("ALL");
  const [approvalSearch, setApprovalSearch] = useState("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeContent, setNoticeContent] = useState("");
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
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !submitting) {
        lastRefreshRef.current = Date.now();
        void refresh(user.id, user.role);
      }
    }, APPROVAL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeTab, refresh, submitting, user.id, user.role]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visibleTabs = useMemo(() => tabs.filter((tab) => (tab.key === "approvals" ? canApprove(user.role) : true)), [user.role]);
  const sortedHistory = useMemo(() => [...history].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [history]);
  const sortedApprovals = useMemo(() => [...approvals].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [approvals]);
  const sortedNotices = useMemo(() => [...notices].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [notices]);
  const inFlight = useMemo(() => sortedHistory.filter((item) => isInFlightStatus(item.requesterRole, item.requesterHasLeader, item.status)), [sortedHistory]);
  const routeOptions = useMemo(() => ["ALL", ...Array.from(new Set(sortedHistory.map((item) => routeOf(item))))], [sortedHistory]);
  const filteredHistory = useMemo(
    () => sortedHistory.filter((item) => (!historySearch || searchText(item).includes(historySearch.toLowerCase())) && (routeFilter === "ALL" || routeOf(item) === routeFilter) && matchHistoryFilter(item, historyFilter)),
    [historyFilter, historySearch, routeFilter, sortedHistory],
  );
  const filteredApprovals = useMemo(() => (!approvalSearch ? sortedApprovals : sortedApprovals.filter((item) => searchText(item).includes(approvalSearch.toLowerCase()))), [approvalSearch, sortedApprovals]);

  async function handleApproval(payload: ApprovalActionInput) {
    const ok = await actOnRequest(payload, user.id, user.role);
    if (ok) setToast(payload.action === "APPROVE" ? "승인 처리되었습니다." : "반려 처리되었습니다.");
  }

  async function handleNoticeSubmit() {
    if (!noticeTitle.trim() || !noticeContent.trim()) return;
    const ok = await createNotice({ title: noticeTitle.trim(), content: noticeContent.trim() }, user.id, user.role);
    if (ok) {
      setNoticeTitle("");
      setNoticeContent("");
      setNoticeOpen(false);
      setToast("공지사항이 등록되었습니다.");
    }
  }

  return (
    <div className="min-h-screen bg-backdrop px-4 py-5 text-ink sm:px-6">
      <div className="mx-auto max-w-[430px] pb-28">
        <header className="rounded-[2rem] border border-white/70 bg-white/90 px-4 py-4 shadow-panel backdrop-blur">
          <BrandMark compact />
          <div className="mt-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-slate/55">{roleLabel(user.role)}</p>
              <h1 className="mt-2 text-[1.85rem] font-semibold tracking-tight text-ink">{user.name}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {user.teamName || user.orgPath.at(-1) || "소속 미지정"} · {user.employeeNo}
              </p>
            </div>
            <button type="button" className="rounded-2xl bg-brand-slate px-3.5 py-2.5 text-sm font-semibold text-white" onClick={() => void logout()}>
              로그아웃
            </button>
          </div>
        </header>

        {error ? (
          <div className="mt-4 rounded-[1.4rem] border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <div className="flex items-center justify-between gap-3">
              <span>{error}</span>
              <button type="button" className="font-semibold" onClick={clearError}>
                닫기
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === "home" ? (
          <section className="mt-4 space-y-4">
            <article className="rounded-[2rem] bg-hero px-5 py-5 text-white shadow-panel">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">Leave Balance</p>
                  <div className="mt-4 flex items-end gap-2">
                    <span className="text-[3rem] font-semibold leading-none">{summary ? formatNumber(summary.remaining) : "--"}</span>
                    <span className="pb-1 text-lg font-medium text-white/82">일</span>
                  </div>
                </div>
                <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white/90">{loading ? "동기화 중" : roleLabel(user.role)}</span>
              </div>
              <div className="mt-6 grid grid-cols-3 gap-3">
                <div className="rounded-[1.4rem] bg-white/12 px-3 py-3">
                  <p className="text-xs text-white/70">부여</p>
                  <p className="mt-2 text-2xl font-semibold">{summary ? formatNumber(summary.entitlement) : "--"}</p>
                </div>
                <div className="rounded-[1.4rem] bg-white/12 px-3 py-3">
                  <p className="text-xs text-white/70">사용</p>
                  <p className="mt-2 text-2xl font-semibold">{summary ? formatNumber(summary.used) : "--"}</p>
                </div>
                <div className="rounded-[1.4rem] bg-white/12 px-3 py-3">
                  <p className="text-xs text-white/70">예정</p>
                  <p className="mt-2 text-2xl font-semibold">{summary ? formatNumber(summary.pending) : "--"}</p>
                </div>
              </div>
            </article>

            <section className="rounded-[1.8rem] border border-white/70 bg-white/90 p-4 shadow-card">
              <div className="grid grid-cols-2 gap-3">
                <button type="button" className="rounded-[1.4rem] bg-brand-slate px-4 py-4 text-left text-white" onClick={() => setRequestOpen(true)}>
                  <span className="block text-base font-semibold">휴가 신청</span>
                </button>
                <a href={ONE_STEP_URL} target="_blank" rel="noreferrer" className="rounded-[1.4rem] bg-accent px-4 py-4 text-left text-white">
                  <span className="block text-base font-semibold">원스텝 제안</span>
                </a>
                <button type="button" className="rounded-[1.4rem] bg-mist px-4 py-4 text-left" onClick={() => setActiveTab("history")}>
                  <span className="block text-sm text-slate-500">내역</span>
                  <span className="mt-2 block text-xl font-semibold text-ink">{history.length}건</span>
                </button>
                <button type="button" className="rounded-[1.4rem] bg-accent/10 px-4 py-4 text-left" onClick={() => setActiveTab(canApprove(user.role) ? "approvals" : "history")}>
                  <span className="block text-sm text-slate-500">{canApprove(user.role) ? "승인 대기" : "진행 중"}</span>
                  <span className="mt-2 block text-xl font-semibold text-accent-strong">{canApprove(user.role) ? filteredApprovals.length : inFlight.length}건</span>
                </button>
              </div>
            </section>

            <section className="rounded-[1.8rem] border border-white/70 bg-white/90 p-4 shadow-card">
              <h2 className="text-lg font-semibold tracking-tight text-ink">연차 관리 (전결)</h2>
              <div className="mt-3 grid gap-3">
                <div className="rounded-[1.4rem] bg-mist px-4 py-4">
                  <p className="text-sm font-semibold text-ink">팀원 연차</p>
                  <p className="mt-2 text-sm text-slate-600">팀원 → 팀장 → 인사</p>
                </div>
                <div className="rounded-[1.4rem] bg-accent/10 px-4 py-4">
                  <p className="text-sm font-semibold text-ink">팀장 연차</p>
                  <p className="mt-2 text-sm text-slate-600">팀장 → 인사 → 원장</p>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-tight text-ink">공지사항</h2>
                {canWriteNotice(user.role) ? (
                  <button type="button" className="rounded-full bg-brand-slate px-4 py-2 text-sm font-semibold text-white" onClick={() => setNoticeOpen((current) => !current)}>
                    {noticeOpen ? "닫기" : "공지 작성"}
                  </button>
                ) : null}
              </div>
              {noticeOpen ? (
                <article className="rounded-[1.6rem] border border-white/70 bg-white/92 p-4 shadow-card">
                  <div className="grid gap-3">
                    <input
                      value={noticeTitle}
                      onChange={(event) => setNoticeTitle(event.target.value)}
                      placeholder="공지 제목"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                    />
                    <textarea
                      rows={4}
                      value={noticeContent}
                      onChange={(event) => setNoticeContent(event.target.value)}
                      placeholder="공지 내용"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                    />
                    <button type="button" disabled={postingNotice} className="rounded-2xl bg-hero px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" onClick={() => void handleNoticeSubmit()}>
                      {postingNotice ? "등록 중..." : "공지 등록"}
                    </button>
                  </div>
                </article>
              ) : null}
              {sortedNotices.length ? sortedNotices.slice(0, 4).map((notice) => <NoticeCard key={notice.id} notice={notice} />) : <EmptyState label="등록된 공지사항이 없습니다." />}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-tight text-ink">진행 중 신청</h2>
                <button type="button" className="text-sm font-semibold text-accent-strong" onClick={() => setActiveTab("history")}>
                  전체 보기
                </button>
              </div>
              {inFlight.length ? (
                inFlight.slice(0, 3).map((item) => (
                  <RequestCard key={item.id} item={item} heading={formatDateRange(item)} subheading={`신청 ${formatDateTime(item.createdAt)}`} meta={routeOf(item)} />
                ))
              ) : (
                <EmptyState label="진행 중인 신청이 없습니다." />
              )}
            </section>
          </section>
        ) : null}

        {activeTab === "history" ? (
          <section className="mt-4 space-y-4">
            <article className="rounded-[1.8rem] border border-white/70 bg-white/90 p-4 shadow-card">
              <div className="grid gap-3">
                <input
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="이름, 사번, 사유 검색"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                />
                <div className="grid grid-cols-2 gap-3">
                  <select value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value as HistoryFilterKey)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10">
                    {historyFilters.map((filter) => (
                      <option key={filter.key} value={filter.key}>
                        {filter.label}
                      </option>
                    ))}
                  </select>
                  <select value={routeFilter} onChange={(event) => setRouteFilter(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10">
                    {routeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option === "ALL" ? "전결 전체" : option}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" disabled={!filteredHistory.length} className="rounded-2xl bg-brand-slate px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" onClick={() => downloadHistoryCsv(filteredHistory)}>
                  엑셀 다운로드 (.csv)
                </button>
              </div>
            </article>

            <div className="text-sm font-semibold text-slate-500">총 {filteredHistory.length}건</div>
            <div className="space-y-3">
              {filteredHistory.length ? (
                filteredHistory.map((item) => (
                  <RequestCard key={item.id} item={item} heading={`${item.employeeName} · ${formatDateRange(item)}`} subheading={`${item.employeeNo} · ${item.teamName} · 신청 ${formatDateTime(item.createdAt)}`} meta={routeOf(item)} />
                ))
              ) : (
                <EmptyState label="조건에 맞는 신청 내역이 없습니다." />
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "approvals" && canApprove(user.role) ? (
          <section className="mt-4 space-y-4">
            <article className="rounded-[1.8rem] border border-white/70 bg-white/90 p-4 shadow-card">
              <input
                value={approvalSearch}
                onChange={(event) => setApprovalSearch(event.target.value)}
                placeholder="이름, 사번, 사유 검색"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
              />
            </article>

            <div className="text-sm font-semibold text-slate-500">처리 대기 {filteredApprovals.length}건</div>
            <div className="space-y-3">
              {filteredApprovals.length ? (
                filteredApprovals.map((item) => (
                  <RequestCard
                    key={item.id}
                    item={item}
                    heading={`${item.employeeName} · ${item.teamName}`}
                    subheading={`${formatDateRange(item)} · ${item.employeeNo}`}
                    meta={routeOf(item)}
                    actionSlot={
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600" onClick={() => void handleApproval({ requestId: item.id, action: "REJECT" })} disabled={submitting}>
                          반려
                        </button>
                        <button type="button" className="rounded-2xl bg-hero px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" onClick={() => void handleApproval({ requestId: item.id, action: "APPROVE" })} disabled={submitting}>
                          승인
                        </button>
                      </div>
                    }
                  />
                ))
              ) : (
                <EmptyState label="처리할 승인 건이 없습니다." />
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "profile" ? (
          <section className="mt-4 space-y-4">
            <article className="rounded-[1.8rem] border border-white/70 bg-white/90 p-5 shadow-card">
              <h2 className="text-lg font-semibold tracking-tight text-ink">내 정보</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-500">
                <div className="flex items-center justify-between gap-3"><span>이름</span><span className="font-semibold text-ink">{user.name}</span></div>
                <div className="flex items-center justify-between gap-3"><span>사번</span><span className="font-semibold text-ink">{user.employeeNo}</span></div>
                <div className="flex items-center justify-between gap-3"><span>권한</span><span className="font-semibold text-ink">{roleLabel(user.role)}</span></div>
                <div className="flex items-center justify-between gap-3"><span>소속</span><span className="text-right font-semibold text-ink">{user.orgPath.join(" > ")}</span></div>
                <div className="flex items-center justify-between gap-3"><span>입사일</span><span className="font-semibold text-ink">{user.joinedAt}</span></div>
              </div>
            </article>
            <article className="rounded-[1.8rem] border border-white/70 bg-white/90 p-5 shadow-card">
              <h2 className="text-lg font-semibold tracking-tight text-ink">연차 현황</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-[1.3rem] bg-mist px-4 py-3"><p className="text-xs text-slate-500">부여</p><p className="mt-2 text-2xl font-semibold text-ink">{summary ? formatNumber(summary.entitlement) : "--"}</p></div>
                <div className="rounded-[1.3rem] bg-mist px-4 py-3"><p className="text-xs text-slate-500">사용</p><p className="mt-2 text-2xl font-semibold text-ink">{summary ? formatNumber(summary.used) : "--"}</p></div>
                <div className="rounded-[1.3rem] bg-accent/10 px-4 py-3"><p className="text-xs text-slate-500">예정</p><p className="mt-2 text-2xl font-semibold text-accent-strong">{summary ? formatNumber(summary.pending) : "--"}</p></div>
                <div className="rounded-[1.3rem] bg-brand-slate px-4 py-3 text-white"><p className="text-xs text-white/70">잔여</p><p className="mt-2 text-2xl font-semibold">{summary ? formatNumber(summary.remaining) : "--"}</p></div>
              </div>
            </article>
          </section>
        ) : null}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40">
        <div className="mx-auto max-w-[430px] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div className="grid gap-2 rounded-[1.8rem] border border-white/70 bg-white/95 p-2 shadow-panel backdrop-blur" style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}>
            {visibleTabs.map((tab) => (
              <button key={tab.key} type="button" className={`rounded-[1.2rem] px-3 py-3 text-sm font-semibold transition ${activeTab === tab.key ? "bg-brand-slate text-white" : "text-slate-500"}`} onClick={() => setActiveTab(tab.key)}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <RequestModal
        open={requestOpen}
        submitting={submitting}
        onClose={() => setRequestOpen(false)}
        onSubmit={async (payload) => {
          const ok = await submitRequest(payload, user.id, user.role);
          if (ok) {
            setRequestOpen(false);
            setActiveTab("home");
            setToast("휴가 신청이 등록되었습니다.");
          }
        }}
        userRole={user.role}
      />

      {toast ? <div className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-brand-slate px-4 py-2 text-sm text-white shadow-lg shadow-brand-slate/20">{toast}</div> : null}
    </div>
  );
}
