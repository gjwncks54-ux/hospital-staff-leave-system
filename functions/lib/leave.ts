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
  return type !== "SICK";
}

export function buildLeaveSummary(
  joinedAt: string,
  role: UserRole,
  hasLeader: boolean,
  rows: Array<{ type: LeaveType; status: LeaveStatus; amount: number }>,
) {
  const cycle = calculateLeaveCycle(joinedAt);
  const stages = getApprovalStages(role, hasLeader);
  const finalStatus = getStatusAfterStage(stages[stages.length - 1]);
  let used = 0;
  let pending = 0;

  for (const row of rows) {
    if (!consumesAnnualBalance(row.type) || row.status === "REJECTED") {
      continue;
    }

    if (row.status === finalStatus) {
      used += row.amount;
    } else {
      pending += row.amount;
    }
  }

  const remaining = Math.max(0, cycle.entitlement - used - pending);

  const summary: LeaveSummary = {
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
    entitlement: cycle.entitlement,
    used,
    pending,
    remaining,
    serviceYears: cycle.serviceYears,
    joinedAt,
  };

  return summary;
}
