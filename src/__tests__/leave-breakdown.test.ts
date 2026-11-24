import { describe, expect, it } from "vitest";
import { splitOwnLeaveHistory } from "../lib/leave-breakdown";
import type { LeaveRequestItem } from "../types";

const item = (overrides: Partial<LeaveRequestItem>): LeaveRequestItem => ({
  id: 1,
  employeeId: 7,
  employeeNo: "WB-0007",
  employeeName: "테스트",
  teamName: "원무팀",
  requesterRole: "USER",
  requesterHasLeader: false,
  type: "ANNUAL",
  startDate: "2026-11-01",
  endDate: "2026-11-01",
  amount: 1,
  reason: "개인 일정",
  status: "APPROVED_HR",
  createdAt: "2026-10-01 00:00:00",
  ...overrides,
});

describe("splitOwnLeaveHistory", () => {
  it("matches balance rules for used and pending requests", () => {
    const result = splitOwnLeaveHistory([
      item({ id: 1 }),
      item({ id: 2, startDate: "2026-12-01", endDate: "2026-12-01" }),
      item({ id: 3, status: "PENDING" }),
      item({ id: 4, type: "UNPAID" }),
      item({ id: 5, employeeId: 8 }),
      item({ id: 6, status: "CANCELLED" }),
    ], 7, "2026-11-24");

    expect(result.used.map((entry) => entry.id)).toEqual([1]);
    expect(result.pending.map((entry) => entry.id)).toEqual([2, 3]);
  });
});
