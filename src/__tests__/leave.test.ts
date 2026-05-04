import { describe, it, expect } from "vitest";
import {
  buildLeaveSummary,
  calculateLeaveCycle,
  calculateRequestAmount,
  resolveCumulativeLeaveAdjustment,
} from "../../functions/lib/leave";

// All dates use KST noon to avoid any boundary issues in tests
const kst = (dateStr: string) => new Date(`${dateStr}T12:00:00+09:00`);

describe("calculateLeaveCycle", () => {
  it("returns serviceYears=0 for under-1-year employee", () => {
    const result = calculateLeaveCycle("2025-01-01", kst("2025-06-01"));
    expect(result.serviceYears).toBe(0);
  });

  it("under-1-year entitlement equals completed months", () => {
    // 5 completed months (Jan→Feb→Mar→Apr→May→Jun, joined Jan 1, asOf Jun 1)
    const result = calculateLeaveCycle("2025-01-01", kst("2025-06-01"));
    expect(result.entitlement).toBe(5);
  });

  it("exactly 1 year → 15 days", () => {
    const result = calculateLeaveCycle("2024-01-01", kst("2025-01-15"));
    expect(result.serviceYears).toBe(1);
    expect(result.entitlement).toBe(15);
  });

  it("uses KST date boundaries for work anniversaries", () => {
    const beforeAnniversary = calculateLeaveCycle("2021-04-26", kst("2026-04-25"));
    const onAnniversary = calculateLeaveCycle("2021-04-26", kst("2026-04-26"));

    expect(beforeAnniversary.serviceYears).toBe(4);
    expect(beforeAnniversary.entitlement).toBe(16);
    expect(onAnniversary.serviceYears).toBe(5);
    expect(onAnniversary.entitlement).toBe(17);
  });

  it("3 years → 16 days (15 + floor((3-1)/2))", () => {
    const result = calculateLeaveCycle("2022-01-01", kst("2025-02-01"));
    expect(result.serviceYears).toBe(3);
    expect(result.entitlement).toBe(16);
  });

  it("10 years → 19 days", () => {
    const result = calculateLeaveCycle("2015-01-01", kst("2025-02-01"));
    expect(result.serviceYears).toBe(10);
    expect(result.entitlement).toBe(19); // 15 + floor(9/2) = 15+4=19
  });

  it("caps at 25 days", () => {
    const result = calculateLeaveCycle("1995-01-01", kst("2025-02-01"));
    expect(result.entitlement).toBe(25);
  });

  it("month-end join date: Jan31 completed months", () => {
    // Jan31 + 2 completed months = Mar31 (exclusive Apr01, asOf Mar31 → 1 month)
    // joinedAt Jan31, asOf Mar01: months = (2025-2025)*12 + (2-0) = 2, Mar01.getDate()=1 < 31 → subtract → 1
    const result = calculateLeaveCycle("2025-01-31", kst("2025-03-01"));
    expect(result.serviceYears).toBe(0);
    expect(result.entitlement).toBe(1); // only 1 complete month (Jan31→Feb28)
  });
});

describe("calculateRequestAmount", () => {
  it("HALF_AM → 0.5", () => {
    expect(calculateRequestAmount("HALF_AM", "2025-01-01", "2025-01-01")).toBe(0.5);
  });

  it("HALF_PM → 0.5", () => {
    expect(calculateRequestAmount("HALF_PM", "2025-01-01", "2025-01-01")).toBe(0.5);
  });

  it("SICK → 0", () => {
    expect(calculateRequestAmount("SICK", "2025-01-01", "2025-01-05")).toBe(0);
  });

  it("ANNUAL single day → 1", () => {
    expect(calculateRequestAmount("ANNUAL", "2025-01-01", "2025-01-01")).toBe(1);
  });

  it("ANNUAL multi-day", () => {
    expect(calculateRequestAmount("ANNUAL", "2025-01-01", "2025-01-05")).toBe(5);
  });

  it("UNPAID multi-day", () => {
    expect(calculateRequestAmount("UNPAID", "2025-03-10", "2025-03-14")).toBe(5);
  });
});

describe("buildLeaveSummary — Fix 4 regression: pending UNPAID must block monthly accrual", () => {
  // Before Fix 4: only finalStatus UNPAID were counted. PENDING UNPAID were ignored,
  // allowing an employee to also spend annual leave in the same period.

  it("PENDING UNPAID blocks the overlapping month", () => {
    const joinedAt = "2025-01-01";
    const asOf = kst("2025-04-01");
    // 3 months: Jan01-Feb01, Feb01-Mar01, Mar01-Apr01
    // UNPAID on Mar15 overlaps month 2 (Mar01-Apr01) → blocked
    const rows = [
      { type: "UNPAID" as const, status: "PENDING" as const, amount: 1, start_date: "2025-03-15", end_date: "2025-03-15" },
    ];
    const summary = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    expect(summary.entitlement).toBe(2);
  });

  it("APPROVED_LEADER UNPAID (intermediate) also blocks the month", () => {
    const joinedAt = "2025-01-01";
    const asOf = kst("2025-04-01");
    const rows = [
      { type: "UNPAID" as const, status: "APPROVED_LEADER" as const, amount: 1, start_date: "2025-03-15", end_date: "2025-03-15" },
    ];
    const summary = buildLeaveSummary(joinedAt, "USER", true, rows, 0, asOf);
    expect(summary.entitlement).toBe(2);
  });

  it("REJECTED UNPAID does NOT block the month", () => {
    const joinedAt = "2025-01-01";
    const asOf = kst("2025-04-01");
    const rows = [
      { type: "UNPAID" as const, status: "REJECTED" as const, amount: 1, start_date: "2025-03-15", end_date: "2025-03-15" },
    ];
    const summary = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    expect(summary.entitlement).toBe(3);
  });

  it("CANCELLED UNPAID does NOT block the month", () => {
    const joinedAt = "2025-01-01";
    const asOf = kst("2025-04-01");
    const rows = [
      { type: "UNPAID" as const, status: "CANCELLED" as const, amount: 1, start_date: "2025-03-15", end_date: "2025-03-15" },
    ];
    const summary = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    expect(summary.entitlement).toBe(3);
  });

  it("UNPAID spanning multiple months blocks each overlapping month once", () => {
    const joinedAt = "2025-01-01";
    const asOf = kst("2025-05-01");
    // 4 months: Jan01-Feb01, Feb01-Mar01, Mar01-Apr01, Apr01-May01
    // UNPAID Feb10-Mar10 overlaps months 1 and 2
    const rows = [
      { type: "UNPAID" as const, status: "PENDING" as const, amount: 28, start_date: "2025-02-10", end_date: "2025-03-10" },
    ];
    const summary = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    expect(summary.entitlement).toBe(2); // months 0 and 3 are clear
  });
});

describe("buildLeaveSummary — Fix 3 regression: month-end clamping (addMonthsClamped)", () => {
  // Fix 3 ensures that period boundaries for month-end join dates don't bleed
  // into adjacent months. E.g., join Jan31: period 0 end = Feb28, period 1 start = Feb28.

  it("UNPAID on last day of period 0 does NOT block period 1 (Jan31 join)", () => {
    const joinedAt = "2025-01-31";
    // asOf=May15: months=(May-Jan)=4, 15<31 → subtract → 3 complete months ✓
    // Period 0: Jan31 → Feb28 (exclusive)   [Feb 2025 has 28 days]
    // Period 1: Feb28 → Mar31 (exclusive)
    // Period 2: Mar31 → Apr30 (exclusive)   [Apr clamped from Apr31]
    const asOf = kst("2025-05-15");
    // UNPAID on Feb27 is inside period 0 (Jan31 ≤ Feb27 < Feb28) → period 0 blocked
    // Period 1 and 2 are clear → entitlement = 2
    const rows = [
      { type: "UNPAID" as const, status: "APPROVED_HR" as const, amount: 1, start_date: "2025-02-27", end_date: "2025-02-27" },
    ];
    const summary = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    expect(summary.entitlement).toBe(2);
  });

  it("UNPAID on Feb28 is in period 1, not period 0 (Jan31 join)", () => {
    const joinedAt = "2025-01-31";
    // Period 0 ends at Feb28 (exclusive) — so Feb28 is NOT in period 0
    // Period 1 starts at Feb28 — so Feb28 IS in period 1
    const asOf = kst("2025-05-15");
    const rows = [
      { type: "UNPAID" as const, status: "APPROVED_HR" as const, amount: 1, start_date: "2025-02-28", end_date: "2025-02-28" },
    ];
    const summary = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    // Period 0 clear (+1), period 1 blocked (+0), period 2 clear (+1) → entitlement = 2
    expect(summary.entitlement).toBe(2);
  });
});

describe("buildLeaveSummary — adjustmentDays", () => {
  it("positive adjustment increases remaining", () => {
    const joinedAt = "2020-01-01";
    const asOf = kst("2025-06-01");
    const rows = [
      { type: "ANNUAL" as const, status: "APPROVED_HR" as const, amount: 5, start_date: "2025-02-01", end_date: "2025-02-05" },
    ];
    const base = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    const adjusted = buildLeaveSummary(joinedAt, "USER", false, rows, 3, asOf);
    expect(adjusted.remaining).toBe(base.remaining + 3);
  });

  it("negative adjustment reduces remaining (but not below 0)", () => {
    const joinedAt = "2020-01-01";
    const asOf = kst("2025-06-01");
    const rows: never[] = [];
    const base = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    const adjusted = buildLeaveSummary(joinedAt, "USER", false, rows, -100, asOf);
    expect(base.remaining).toBeGreaterThan(0);
    expect(adjusted.remaining).toBe(0); // clamped at 0
  });

  it("adjustmentDays does not affect entitlement count", () => {
    const joinedAt = "2020-01-01";
    const asOf = kst("2025-06-01");
    const rows: never[] = [];
    const base = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    const adjusted = buildLeaveSummary(joinedAt, "USER", false, rows, 5, asOf);
    expect(adjusted.entitlement).toBe(base.entitlement);
  });
});

describe("buildLeaveSummary — cumulative accrual", () => {
  it("carries first-year monthly leave into the first annual grant", () => {
    const joinedAt = "2025-04-28";
    const asOf = kst("2026-05-02");
    const rows = [
      {
        type: "ANNUAL" as const,
        status: "APPROVED_HR" as const,
        amount: 1,
        start_date: "2026-05-04",
        end_date: "2026-05-04",
        created_at: "2026-04-23 01:00:11",
      },
    ];

    const summary = buildLeaveSummary(joinedAt, "USER", true, rows, -5.5, asOf);

    expect(summary.entitlement).toBe(26);
    expect(summary.used).toBe(0);
    expect(summary.pending).toBe(1);
    expect(summary.remaining).toBe(19.5);
  });

  it("keeps an under-one-year monthly accrual visible after the monthly date", () => {
    const summary = buildLeaveSummary("2025-07-21", "USER", true, [], -8, kst("2026-05-02"));

    expect(summary.entitlement).toBe(9);
    expect(summary.remaining).toBe(1);
  });
});

describe("resolveCumulativeLeaveAdjustment", () => {
  it("converts a legacy cycle-based adjustment into a cumulative adjustment", () => {
    const rows = [
      {
        type: "ANNUAL" as const,
        status: "APPROVED_HR" as const,
        amount: 1,
        start_date: "2026-05-07",
        end_date: "2026-05-07",
        created_at: "2026-04-23 01:05:10",
      },
    ];
    const adjustment = resolveCumulativeLeaveAdjustment(
      "2021-04-27",
      "USER",
      true,
      rows,
      -14,
      "2026-04-22 23:59:07",
    );
    const summary = buildLeaveSummary("2021-04-27", "USER", true, rows, adjustment, kst("2026-05-02"));

    expect(adjustment).toBe(-71);
    expect(summary.entitlement).toBe(90);
    expect(summary.remaining).toBe(18);
  });
});

describe("buildLeaveSummary — pending vs used leave", () => {
  it("approved leave counts as used", () => {
    const joinedAt = "2020-01-01";
    const asOf = kst("2025-06-01");
    const rows = [
      { type: "ANNUAL" as const, status: "APPROVED_HR" as const, amount: 5, start_date: "2025-02-01", end_date: "2025-02-05" },
    ];
    const summary = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    expect(summary.used).toBe(5);
    expect(summary.pending).toBe(0);
  });

  it("approved future leave counts as pending until the start date", () => {
    const joinedAt = "2020-01-01";
    const asOf = kst("2025-06-01");
    const rows = [
      { type: "ANNUAL" as const, status: "APPROVED_HR" as const, amount: 2, start_date: "2025-06-10", end_date: "2025-06-11" },
    ];
    const summary = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    expect(summary.used).toBe(0);
    expect(summary.pending).toBe(2);
  });

  it("approved leave counts as used on its start date", () => {
    const joinedAt = "2020-01-01";
    const asOf = kst("2025-06-10");
    const rows = [
      { type: "ANNUAL" as const, status: "APPROVED_HR" as const, amount: 2, start_date: "2025-06-10", end_date: "2025-06-11" },
    ];
    const summary = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    expect(summary.used).toBe(2);
    expect(summary.pending).toBe(0);
  });

  it("pending leave counts as pending", () => {
    const joinedAt = "2020-01-01";
    const asOf = kst("2025-06-01");
    const rows = [
      { type: "ANNUAL" as const, status: "PENDING" as const, amount: 3, start_date: "2025-02-01", end_date: "2025-02-03" },
    ];
    const summary = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    expect(summary.used).toBe(0);
    expect(summary.pending).toBe(3);
  });

  it("rejected leave is not counted", () => {
    const joinedAt = "2020-01-01";
    const asOf = kst("2025-06-01");
    const rows = [
      { type: "ANNUAL" as const, status: "REJECTED" as const, amount: 5, start_date: "2025-02-01", end_date: "2025-02-05" },
    ];
    const summary = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    expect(summary.used).toBe(0);
    expect(summary.pending).toBe(0);
  });

  it("SICK leave does not consume annual balance", () => {
    const joinedAt = "2020-01-01";
    const asOf = kst("2025-06-01");
    const rows = [
      { type: "SICK" as const, status: "APPROVED_HR" as const, amount: 0, start_date: "2025-02-01", end_date: "2025-02-03" },
    ];
    const summary = buildLeaveSummary(joinedAt, "USER", false, rows, 0, asOf);
    expect(summary.used).toBe(0);
  });
});
