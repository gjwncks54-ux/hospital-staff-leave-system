import { getApprovalStages, getStatusAfterStage } from "../../src/lib/approval-flow";
import type { LeaveSummary, UserRole } from "../../src/types";
import type { LeaveStatus, LeaveType } from "./db";

const DAY_MS = 86400000;

function parseDateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function parseDate(value: string) {
  const { year, month, day } = parseDateParts(value);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatKstDate(date: Date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function formatDbTimestamp(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function parseDbTimestamp(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseDate(value);
  }

  return new Date(`${value.replace(" ", "T")}Z`);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
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

function addYearsClamped(joinedAtStr: string, years: number): Date {
  return addMonthsClamped(joinedAtStr, years * 12);
}

function annualGrantForServiceYears(serviceYears: number) {
  return Math.min(15 + Math.floor((serviceYears - 1) / 2), 25);
}

function overlapsRange(rowStartDate: string, rowEndDate: string, periodStart: Date, periodEndExclusive: Date) {
  const rowStart = parseDate(rowStartDate);
  const rowEndExclusive = addDays(parseDate(rowEndDate), 1);
  return rowStart < periodEndExclusive && rowEndExclusive > periodStart;
}

function fullYearsBetween(joinedAt: string, asOfDate: string) {
  const joined = parseDateParts(joinedAt);
  const asOf = parseDateParts(asOfDate);
  let years = asOf.year - joined.year;
  if (asOf.month < joined.month || (asOf.month === joined.month && asOf.day < joined.day)) {
    years -= 1;
  }
  return Math.max(0, years);
}

function completedMonthsUnderOneYear(joinedAt: string, asOfDate: string) {
  const joined = parseDateParts(joinedAt);
  const asOf = parseDateParts(asOfDate);
  let months = (asOf.year - joined.year) * 12 + (asOf.month - joined.month);
  if (asOf.day < joined.day) {
    months -= 1;
  }
  return Math.min(Math.max(months, 0), 11);
}

export function calculateLeaveCycle(joinedAt: string, asOf = new Date()) {
  const asOfDate = formatKstDate(asOf);
  const serviceYears = fullYearsBetween(joinedAt, asOfDate);

  if (serviceYears < 1) {
    return {
      cycleStart: joinedAt,
      cycleEnd: formatDate(addYearsClamped(joinedAt, 1)),
      serviceYears,
      entitlement: completedMonthsUnderOneYear(joinedAt, asOfDate),
    };
  }

  const cycleStart = addYearsClamped(joinedAt, serviceYears);
  const cycleEnd = addYearsClamped(joinedAt, serviceYears + 1);

  return {
    cycleStart: formatDate(cycleStart),
    cycleEnd: formatDate(cycleEnd),
    serviceYears,
    entitlement: annualGrantForServiceYears(serviceYears),
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
  rows: LeaveBalanceRow[],
  asOf: Date,
) {
  const completedMonths = completedMonthsUnderOneYear(joinedAt, formatKstDate(asOf));
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

type LeaveBalanceRow = {
  type: LeaveType;
  status: LeaveStatus;
  amount: number;
  start_date: string;
  end_date: string;
  created_at?: string | null;
};

function getRowsCreatedOnOrBefore(rows: LeaveBalanceRow[], asOf: Date) {
  return rows.filter((row) => !row.created_at || parseDbTimestamp(row.created_at).getTime() <= asOf.getTime());
}

function getRowsInCurrentCycle(joinedAt: string, rows: LeaveBalanceRow[], asOf: Date) {
  const cycle = calculateLeaveCycle(joinedAt, asOf);
  const cycleStart = parseDate(cycle.cycleStart);
  const cycleEnd = parseDate(cycle.cycleEnd);
  return rows.filter((row) => overlapsRange(row.start_date, row.end_date, cycleStart, cycleEnd));
}

function calculateCumulativeEntitlement(joinedAt: string, rows: LeaveBalanceRow[], asOf: Date) {
  const asOfDate = formatKstDate(asOf);
  const serviceYears = fullYearsBetween(joinedAt, asOfDate);

  if (serviceYears < 1) {
    return calculateUnderOneYearEntitlement(joinedAt, rows, asOf);
  }

  let entitlement = calculateUnderOneYearEntitlement(joinedAt, rows, addYearsClamped(joinedAt, 1));
  for (let years = 1; years <= serviceYears; years += 1) {
    entitlement += annualGrantForServiceYears(years);
  }

  return entitlement;
}

function buildConsumedLeaveTotals(
  role: UserRole,
  hasLeader: boolean,
  rows: LeaveBalanceRow[],
  asOf: Date,
) {
  const stages = getApprovalStages(role, hasLeader);
  const finalStatus = getStatusAfterStage(stages[stages.length - 1]);
  const asOfDate = formatKstDate(asOf);
  let used = 0;
  let pending = 0;

  for (const row of rows) {
    if (!consumesAnnualBalance(row.type) || row.status === "REJECTED" || row.status === "CANCELLED") {
      continue;
    }

    if (row.status === finalStatus && row.start_date <= asOfDate) {
      used += row.amount;
    } else {
      pending += row.amount;
    }
  }

  return { used, pending };
}

function buildCurrentCycleBaseSummary(
  joinedAt: string,
  role: UserRole,
  hasLeader: boolean,
  rows: LeaveBalanceRow[],
  asOf: Date,
) {
  const cycle = calculateLeaveCycle(joinedAt, asOf);
  const cycleRows = getRowsInCurrentCycle(joinedAt, rows, asOf);
  const { used, pending } = buildConsumedLeaveTotals(role, hasLeader, cycleRows, asOf);
  const entitlement =
    cycle.serviceYears < 1 ? calculateUnderOneYearEntitlement(joinedAt, cycleRows, asOf) : cycle.entitlement;

  return { entitlement, used, pending };
}

function getBaseRemaining(summary: { entitlement: number; used: number; pending: number }) {
  return summary.entitlement - summary.used - summary.pending;
}

function roundLeaveDays(value: number) {
  return Number(value.toFixed(1));
}

export function resolveCumulativeLeaveAdjustment(
  joinedAt: string,
  role: UserRole,
  hasLeader: boolean,
  rows: LeaveBalanceRow[],
  cycleAdjustmentDays: number,
  adjustmentAnchorAt?: string | null,
) {
  const anchorDate = adjustmentAnchorAt ? parseDbTimestamp(adjustmentAnchorAt) : new Date();
  const anchorRows = getRowsCreatedOnOrBefore(rows, anchorDate);
  const cumulativeBase = getBaseRemaining(buildLeaveSummary(joinedAt, role, hasLeader, anchorRows, 0, anchorDate));
  const cycleBase = getBaseRemaining(buildCurrentCycleBaseSummary(joinedAt, role, hasLeader, anchorRows, anchorDate));

  return roundLeaveDays(cycleAdjustmentDays + cycleBase - cumulativeBase);
}

export function convertCumulativeAdjustmentToCycleAdjustment(
  joinedAt: string,
  role: UserRole,
  hasLeader: boolean,
  rows: LeaveBalanceRow[],
  cumulativeAdjustmentDays: number,
  asOf = new Date(),
) {
  const cumulativeBase = getBaseRemaining(buildLeaveSummary(joinedAt, role, hasLeader, rows, 0, asOf));
  const cycleBase = getBaseRemaining(buildCurrentCycleBaseSummary(joinedAt, role, hasLeader, rows, asOf));

  return roundLeaveDays(cumulativeAdjustmentDays + cumulativeBase - cycleBase);
}

export function buildLeaveSummary(
  joinedAt: string,
  role: UserRole,
  hasLeader: boolean,
  rows: LeaveBalanceRow[],
  adjustmentDays = 0,
  asOf = new Date(),
) {
  const cycle = calculateLeaveCycle(joinedAt, asOf);
  const { used, pending } = buildConsumedLeaveTotals(role, hasLeader, rows, asOf);
  const entitlement = calculateCumulativeEntitlement(joinedAt, rows, asOf);
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
