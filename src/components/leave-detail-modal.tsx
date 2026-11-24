import { getLeaveStatusLabel } from "../lib/approval-flow";
import { splitOwnLeaveHistory } from "../lib/leave-breakdown";
import type { LeaveRequestItem, LeaveSummary } from "../types";

interface LeaveDetailModalProps {
  mode: "USED" | "PENDING" | null;
  summary: LeaveSummary | null;
  history: LeaveRequestItem[];
  employeeId: number;
  onClose: () => void;
}

const typeLabel = {
  ANNUAL: "연차",
  HALF_AM: "반차 오전",
  HALF_PM: "반차 오후",
} as const;

const formatDate = (value: string) => value.replace(/-/g, ".");
const formatDateRange = (startDate: string, endDate: string) => startDate === endDate ? formatDate(startDate) : `${formatDate(startDate)} ~ ${formatDate(endDate)}`;
const formatDays = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}일`;

export function LeaveDetailModal({ mode, summary, history, employeeId, onClose }: LeaveDetailModalProps) {
  if (!mode || !summary) {
    return null;
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const breakdown = splitOwnLeaveHistory(history, employeeId, today);
  const items = mode === "USED" ? breakdown.used : breakdown.pending;
  const total = mode === "USED" ? summary.used : summary.pending;
  const actualUsed = breakdown.used.reduce((sum, item) => sum + item.amount, 0);
  const initialBalanceAdjustment = Number((summary.used - actualUsed).toFixed(1));
  const showInitialBalanceAdjustment = mode === "USED" && Math.abs(initialBalanceAdjustment) >= 0.1;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 px-3 pt-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="leave-detail-title">
      <section className="w-full max-w-md rounded-t-[2rem] bg-white px-5 pb-7 pt-4 shadow-2xl shadow-slate-950/15">
        <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-slate-200" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="leave-detail-title" className="text-xl font-semibold tracking-tight text-ink">{mode === "USED" ? "사용 내역" : "예정 내역"}</h2>
            <p className="mt-1 text-sm text-slate-500">{mode === "USED" ? "사용일이 지난 최종 승인 휴가" : "승인 대기 또는 사용 예정 휴가"}</p>
          </div>
          <button type="button" className="rounded-2xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600" onClick={onClose}>닫기</button>
        </div>

        <div className="mt-5 flex items-end justify-between rounded-[1.4rem] bg-mist px-4 py-4">
          <span className="text-sm font-medium text-slate-600">{mode === "USED" ? "총 사용" : "총 예정"}</span>
          <strong className="text-2xl font-semibold text-ink">{total.toFixed(1)}일</strong>
        </div>

        <div className="mt-4 max-h-[52vh] space-y-2 overflow-y-auto pr-1">
          {items.map((item) => (
            <div key={item.id} className="rounded-[1.2rem] border border-slate-100 bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-ink">{typeLabel[item.type as keyof typeof typeLabel]}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatDateRange(item.startDate, item.endDate)}</p>
                </div>
                <span className="text-sm font-semibold text-accent-strong">{item.amount.toFixed(1)}일</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span className="truncate">{item.reason}</span>
                <span className="shrink-0">{getLeaveStatusLabel(item.requesterRole, item.requesterHasLeader, item.status)}</span>
              </div>
            </div>
          ))}

          {showInitialBalanceAdjustment ? (
            <div className="flex items-center justify-between gap-4 rounded-[1.2rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink">초기 잔액 반영</p>
                <p className="mt-1 text-xs text-slate-500">기존 자료 이관 및 관리자 조정</p>
              </div>
              <span className="text-sm font-semibold text-slate-600">{formatDays(initialBalanceAdjustment)}</span>
            </div>
          ) : null}

          {!items.length && !showInitialBalanceAdjustment ? (
            <p className="rounded-[1.2rem] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">표시할 내역이 없습니다.</p>
          ) : null}
        </div>

        <p className="mt-4 rounded-[1.2rem] bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
          {mode === "USED"
            ? "사용 합계에는 기존 자료 이관 시 반영된 초기 잔액 조정이 포함될 수 있습니다."
            : "승인 대기 중인 신청은 최종 승인 또는 반려 결과에 따라 예정 합계가 달라집니다."}
        </p>
      </section>
    </div>
  );
}
