import { FormEvent, useEffect, useMemo, useState } from "react";
import type { LeaveRequestInput, LeaveType } from "../types";

interface RequestModalProps {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: LeaveRequestInput) => Promise<void>;
}

const leaveOptions: Array<{ value: LeaveType; label: string; helper: string }> = [
  { value: "ANNUAL", label: "연차 (전일)", helper: "일 단위 차감" },
  { value: "HALF_AM", label: "반차 (오전)", helper: "0.5일 차감" },
  { value: "HALF_PM", label: "반차 (오후)", helper: "0.5일 차감" },
  { value: "SICK", label: "병가", helper: "연차 잔여와 분리해 관리" },
];

function getEstimatedAmount(type: LeaveType, startDate: string, endDate: string) {
  if (type === "HALF_AM" || type === "HALF_PM") {
    return 0.5;
  }

  if (!startDate || !endDate) {
    return 1;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

export function RequestModal({ open, submitting, onClose, onSubmit }: RequestModalProps) {
  const [type, setType] = useState<LeaveType>("ANNUAL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    setStartDate(today);
    setEndDate(today);
    setReason("");
    setType("ANNUAL");
  }, [open]);

  const estimatedAmount = useMemo(() => getEstimatedAmount(type, startDate, endDate), [type, startDate, endDate]);

  if (!open) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      type,
      startDate,
      endDate,
      reason,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 px-3 pb-0 pt-8 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-t-[2rem] bg-white px-5 pb-7 pt-4 shadow-2xl shadow-slate-950/15">
        <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-slate-200" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-ink">휴가 신청서</h2>
            <p className="mt-1 text-sm text-slate-500">반차는 오전/오후 0.5일 기준으로 처리됩니다.</p>
          </div>
          <button
            type="button"
            className="rounded-2xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-500"
            onClick={onClose}
          >
            닫기
          </button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-600">휴가 유형</span>
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
              value={type}
              onChange={(event) => setType(event.target.value as LeaveType)}
            >
              {leaveOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-600">시작일</span>
              <input
                required
                type="date"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  if (event.target.value > endDate) {
                    setEndDate(event.target.value);
                  }
                }}
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-600">종료일</span>
              <input
                required
                type="date"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                value={endDate}
                min={startDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-600">사유</span>
            <textarea
              required
              rows={4}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="예: 건강검진, 가족행사, 진료 예약"
            />
          </label>

          <div className="rounded-3xl bg-accent/10 px-4 py-3 text-sm text-accent-strong">
            <p className="font-semibold">예상 차감: {estimatedAmount.toFixed(1)}일</p>
            <p className="mt-1 text-accent-strong/80">승인 단계: 신청 → 팀장 승인 → HR 최종 승인</p>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-hero px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "신청 중..." : "신청 올리기"}
          </button>
        </form>
      </div>
    </div>
  );
}
