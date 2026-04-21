import { describe, it, expect } from "vitest";
import {
  getApprovalStages,
  getNextPendingStage,
  isFinalApprovedStatus,
  getLeaveStatusLabel,
  getStatusAfterStage,
} from "../../src/lib/approval-flow";

describe("getApprovalStages", () => {
  it("LEADER: HR only", () => {
    expect(getApprovalStages("LEADER", true)).toEqual(["HR"]);
    expect(getApprovalStages("LEADER", false)).toEqual(["HR"]);
  });

  it("USER without leader: HR only", () => {
    expect(getApprovalStages("USER", false)).toEqual(["HR"]);
  });

  it("USER with leader: LEADER -> HR", () => {
    expect(getApprovalStages("USER", true)).toEqual(["LEADER", "HR"]);
  });

  it("HR with leader: LEADER -> HR", () => {
    expect(getApprovalStages("HR", true)).toEqual(["LEADER", "HR"]);
  });
});

describe("getNextPendingStage", () => {
  it("PENDING USER no-leader -> next is HR", () => {
    expect(getNextPendingStage("USER", false, "PENDING")).toBe("HR");
  });

  it("PENDING USER with-leader -> next is LEADER", () => {
    expect(getNextPendingStage("USER", true, "PENDING")).toBe("LEADER");
  });

  it("APPROVED_LEADER USER with-leader -> next is HR", () => {
    expect(getNextPendingStage("USER", true, "APPROVED_LEADER")).toBe("HR");
  });

  it("APPROVED_HR USER no-leader -> null (final)", () => {
    expect(getNextPendingStage("USER", false, "APPROVED_HR")).toBeNull();
  });

  it("APPROVED_HR USER with-leader -> null (final)", () => {
    expect(getNextPendingStage("USER", true, "APPROVED_HR")).toBeNull();
  });

  it("APPROVED_HR LEADER -> null (final)", () => {
    expect(getNextPendingStage("LEADER", true, "APPROVED_HR")).toBeNull();
  });

  it("APPROVED_DIRECTOR legacy LEADER row -> null (final)", () => {
    expect(getNextPendingStage("LEADER", true, "APPROVED_DIRECTOR")).toBeNull();
  });

  it("REJECTED -> null", () => {
    expect(getNextPendingStage("USER", false, "REJECTED")).toBeNull();
  });

  it("CANCELLED -> null", () => {
    expect(getNextPendingStage("USER", false, "CANCELLED")).toBeNull();
  });
});

describe("isFinalApprovedStatus", () => {
  it("PENDING is not final", () => {
    expect(isFinalApprovedStatus("USER", false, "PENDING")).toBe(false);
  });

  it("REJECTED is not final", () => {
    expect(isFinalApprovedStatus("USER", false, "REJECTED")).toBe(false);
  });

  it("CANCELLED is not final", () => {
    expect(isFinalApprovedStatus("USER", false, "CANCELLED")).toBe(false);
  });

  it("APPROVED_HR for USER no-leader is final", () => {
    expect(isFinalApprovedStatus("USER", false, "APPROVED_HR")).toBe(true);
  });

  it("APPROVED_HR for USER with-leader is final", () => {
    expect(isFinalApprovedStatus("USER", true, "APPROVED_HR")).toBe(true);
  });

  it("APPROVED_LEADER for USER with-leader is not final", () => {
    expect(isFinalApprovedStatus("USER", true, "APPROVED_LEADER")).toBe(false);
  });

  it("APPROVED_HR for LEADER is final", () => {
    expect(isFinalApprovedStatus("LEADER", true, "APPROVED_HR")).toBe(true);
  });

  it("APPROVED_DIRECTOR for LEADER stays final for legacy rows", () => {
    expect(isFinalApprovedStatus("LEADER", true, "APPROVED_DIRECTOR")).toBe(true);
  });
});

describe("getStatusAfterStage", () => {
  it("LEADER -> APPROVED_LEADER", () => {
    expect(getStatusAfterStage("LEADER")).toBe("APPROVED_LEADER");
  });

  it("HR -> APPROVED_HR", () => {
    expect(getStatusAfterStage("HR")).toBe("APPROVED_HR");
  });

  it("DIRECTOR -> APPROVED_DIRECTOR", () => {
    expect(getStatusAfterStage("DIRECTOR")).toBe("APPROVED_DIRECTOR");
  });
});

describe("getLeaveStatusLabel", () => {
  it("PENDING shows next stage label", () => {
    expect(getLeaveStatusLabel("USER", false, "PENDING")).toBe("인사 승인 대기");
    expect(getLeaveStatusLabel("USER", true, "PENDING")).toBe("팀장 승인 대기");
  });

  it("REJECTED -> 반려", () => {
    expect(getLeaveStatusLabel("USER", false, "REJECTED")).toBe("반려");
  });

  it("CANCELLED -> 취소", () => {
    expect(getLeaveStatusLabel("USER", false, "CANCELLED")).toBe("취소");
  });

  it("final approved -> 최종 승인", () => {
    expect(getLeaveStatusLabel("USER", false, "APPROVED_HR")).toBe("최종 승인");
    expect(getLeaveStatusLabel("LEADER", true, "APPROVED_HR")).toBe("최종 승인");
    expect(getLeaveStatusLabel("LEADER", true, "APPROVED_DIRECTOR")).toBe("최종 승인");
  });

  it("intermediate approved shows next stage", () => {
    expect(getLeaveStatusLabel("USER", true, "APPROVED_LEADER")).toBe("인사 승인 대기");
  });
});
