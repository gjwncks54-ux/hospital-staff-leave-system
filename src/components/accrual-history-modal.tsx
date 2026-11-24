import type { LeaveSummary } from "../types";

interface AccrualHistoryModalProps {
  open: boolean;
  summary: LeaveSummary | null;
  onClose: () => void;
}

const formatDate = (value: string) => value.replace(/-/g, ".");

export function AccrualHistoryModal({ open, summary, onClose }: AccrualHistoryModalProps) {
  if (!open || !summary) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 px-3 pt-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="accrual-history-title">
      <section className="w-full max-w-md rounded-t-[2rem] bg-white px-5 pb-7 pt-4 shadow-2xl shadow-slate-950/15">
        <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-slate-200" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="accrual-history-title" className="text-xl font-semibold tracking-tight text-ink">연·월차 발생 내역</h2>
            <p className="mt-1 text-sm text-slate-500">입사일 기준 자동 발생분</p>
          </div>
          <button type="button" className="rounded-2xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="mt-5 flex items-end justify-between rounded-[1.4rem] bg-mist px-4 py-4">
          <span className="text-sm font-medium text-slate-600">누적 자동 발생</span>
          <strong className="text-2xl font-semibold text-ink">{summary.entitlement.toFixed(1)}일</strong>
        </div>

        <div className="mt-4 max-h-[52vh] space-y-2 overflow-y-auto pr-1">
          {summary.accrualEvents.map((event) => (
            <div key={`${event.kind}-${event.date}`} className="flex items-center justify-between gap-4 rounded-[1.2rem] border border-slate-100 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink">{event.kind === "ANNUAL" ? "정기 연차" : "월차"}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDate(event.date)}</p>
              </div>
              <span className={`text-sm font-semibold ${event.status === "BLOCKED" ? "text-slate-400" : "text-accent-strong"}`}>
                {event.status === "BLOCKED" ? "무급휴가로 미발생" : `+${event.days.toFixed(1)}일`}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-4 rounded-[1.2rem] bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
          현재 잔여일수는 휴가 사용·예정 내역과 기존 자료 이관 시 반영된 초기 잔액 조정을 포함할 수 있어 발생 합계와 차이가 있을 수 있습니다.
        </p>
      </section>
    </div>
  );
}
