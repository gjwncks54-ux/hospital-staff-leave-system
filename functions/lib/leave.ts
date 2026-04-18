import { getApprovalStages, getStatusAfterStage } from "../../src/lib/approval-flow";
import type { LeaveSummary, UserRole } from "../../src/types";
import type { LeaveStatus, LeaveType } from "./db";

const DAY_MS = 86400000;

function parseDate(value: string) {
  return new Date(`${value}T00:00:00+09:00`);
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonthsClamped(joinedAtStr: string, months: number): Date {
  const [y, m, d] = joinedAtStr.split("-").map(Number);
  const totalMonths = y * 12 + (m - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(d, lastDay);
  const mm = String(targetMonth + 1).padStart(2, "0");
  const dd = String(clampedDay).padStart(2, "0");
  return parseDate(`${targetYear}-${mm}-${dd}`);
}

function overlapsRange(rowStartDate: string, rowEndDate: string, periodStart: Date, periodEndExclusive: Date) {
  const rowStart = parseDate(rowStartDate);
  const rowEndExclusive = addDays(parseDate(rowEndDate), 1);
  return rowStart < periodEndExclusive && rowEndExclusive > periodStart;
}

function fullYearsBetween(start: Date, end: Date) {
  let years = end.getFullYear() - start.getFullYear();
  const anniversaryThisYear = new Date(end.getFullYear(), start.getMonth(), start.getDate());
  if (end < anniversaryThisYear) {
    years -= 1;
  }
  return Math.max(0, years);
}

function completedMonthsUnderOneYear(joinedAt: Date, asOf: Date) {
  let months = (asOf.getFullYear() - joinedAt.getFullYear()) * 12 + (asOf.getMonth() - joinedAt.getMonth());
  if (asOf.getDate() < joinedAt.getDate()) {
    months -= 1;
  }
  return Math.min(Math.max(months, 0), 11);
}

export function calculateLeaveCycle(joinedAt: string, asOf = new Date()) {
  const joined = parseDate(joinedAt);
  const serviceYears = fullYearsBetween(joined, asOf);

  if (serviceYears < 1) {
    const cycleEnd = new Date(joined);
    cycleEnd.setFullYear(cycleEnd.getFullYear() + 1);

    return {
      cycleStart: formatDate(joined),
      cycleEnd: formatDate(cycleEnd),
      serviceYears,
      entitlement: completedMonthsUnderOneYear(joined, asOf),
    };
  }

  const anniversaryThisYear = new Date(asOf.getFullYear(), joined.getMonth(), joined.getDate());
  const cycleStart = asOf < anniversaryThisYear ? new Date(asOf.getFullYear() - 1, joined.getMonth(), joined.getDate()) : anniversaryThisYear;
  const cycleEnd = new Date(cycleStart);
  cycleEnd.setFullYear(cycleEnd.getFullYear() + 1);

  return {
    cycleStart: formatDate(cycleStart),
    cycleEnd: formatDate(cycleEnd),
    serviceYears,
    entitlement: Math.min(15 + Math.floor((serviceYears - 1) / 2), 25),
  };
}

export function calculateRequestAmount(type: LeaveType, startDate: string, endDate: string) {
  if (type === "HALF_AM" || type === "HALF_PM") {
    return 0.5;
  }

  if (type === "SICK") {
    return 0;
  }

  const start = parseDate(startDate);
  const end = parseDate(endDate);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
}

export function consumesAnnualBalance(type: LeaveType) {
  return type !== "SICK" && type !== "UNPAID";
}

function calculateUnderOneYearEntitlement(
  joinedAt: string,
  finalStatus: LeaveStatus,
  rows: Array<{ type: LeaveType; status: LeaveStatus; amount: number; start_date: string; end_date: string }>,
  asOf: Date,
) {
  const joined = parseDate(joinedAt);
  const completedMonths = completedMonthsUnderOneYear(joined, asOf);
  const approvedUnpaidRows = rows.filter(
    (row) => row.type === "UNPAID" && row.status !== "REJECTED" && row.status !== "CANCELLED",
  );

  let entitlement = 0;

  for (let monthIndex = 0; monthIndex < completedMonths; monthIndex += 1) {
    const periodStart = addMonthsClamped(joinedAt, monthIndex);
    const periodEndExclusive = addMonthsClamped(joinedAt, monthIndex + 1);
    const blockedByUnpaidLeave = approvedUnpaidRows.some((row) => overlapsRange(row.start_date, row.end_date, periodStart, periodEndExclusive));

    if (!blockedByUnpaidLeave) {
      entitlement += 1;
    }
  }

  return entitlement;
}

export function buildLeaveSummary(
  joinedAt: string,
  role: UserRole,
  hasLeader: boolean,
  rows: Array<{ type: LeaveType; status: LeaveStatus; amount: number; start_date: string; end_date: string }>,
  adjustmentDays = 0,
  asOf = new Date(),
) {
  const cycle = calculateLeaveCycle(joinedAt, asOf);
  const stages = getApprovalStages(role, hasLeader);
  const finalStatus = getStatusAfterStage(stages[stages.length - 1]);
  let used = 0;
  let pending = 0;

  for (const row of rows) {
    if (!consumesAnnualBalance(row.type) || row.status === "REJECTED" || row.status === "CANCELLED") {
      continue;
    }

    if (row.status === finalStatus) {
      used += row.amount;
    } else {
      pending += row.amount;
    }
  }

  const entitlement =
    cycle.serviceYears < 1 ? calculateUnderOneYearEntitlement(joinedAt, finalStatus, rows, asOf) : cycle.entitlement;
  const remaining = Math.max(0, entitlement + adjustmentDays - used - pending);

  const summary: LeaveSummary = {
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
    entitlement,
    used,
    pending,
    remaining,
    serviceYears: cycle.serviceYears,
    joinedAt,
  };

  return summary;
}
