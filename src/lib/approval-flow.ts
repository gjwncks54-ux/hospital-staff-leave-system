import type { LeaveStatus, UserRole } from "../types";

export type ApprovalStage = "LEADER" | "HR" | "DIRECTOR";

const stageStatusMap: Record<ApprovalStage, LeaveStatus> = {
  LEADER: "APPROVED_LEADER",
  HR: "APPROVED_HR",
  DIRECTOR: "APPROVED_DIRECTOR",
};

export function getApprovalStages(role: UserRole, hasLeader: boolean) {
  if (role === "LEADER") {
    return ["HR", "DIRECTOR"] as ApprovalStage[];
  }

  if (!hasLeader) {
    return ["HR"] as ApprovalStage[];
  }

  return ["LEADER", "HR"] as ApprovalStage[];
}

export function getStageLabel(stage: ApprovalStage) {
  switch (stage) {
    case "LEADER":
      return "팀장";
    case "HR":
      return "인사";
    case "DIRECTOR":
      return "원장";
  }
}

export function getStageDescription(stage: ApprovalStage) {
  switch (stage) {
    case "LEADER":
      return "팀장 승인";
    case "HR":
      return "인사 승인";
    case "DIRECTOR":
      return "원장 승인";
  }
}

export function getStatusAfterStage(stage: ApprovalStage) {
  return stageStatusMap[stage];
}

export function getApprovedStage(status: LeaveStatus): ApprovalStage | null {
  switch (status) {
    case "APPROVED_LEADER":
      return "LEADER";
    case "APPROVED_HR":
      return "HR";
    case "APPROVED_DIRECTOR":
      return "DIRECTOR";
    default:
      return null;
  }
}

export function getNextPendingStage(role: UserRole, hasLeader: boolean, status: LeaveStatus): ApprovalStage | null {
  if (status === "REJECTED") {
    return null;
  }

  const stages = getApprovalStages(role, hasLeader);
  const approvedStage = getApprovedStage(status);

  if (!approvedStage) {
    return stages[0] ?? null;
  }

  const nextIndex = stages.indexOf(approvedStage) + 1;
  return stages[nextIndex] ?? null;
}

export function isFinalApprovedStatus(role: UserRole, hasLeader: boolean, status: LeaveStatus) {
  return status !== "PENDING" && status !== "REJECTED" && getNextPendingStage(role, hasLeader, status) === null;
}

export function isInFlightStatus(role: UserRole, hasLeader: boolean, status: LeaveStatus) {
  return status !== "REJECTED" && !isFinalApprovedStatus(role, hasLeader, status);
}

export function getApprovalRouteLabel(role: UserRole, hasLeader: boolean) {
  return getApprovalStages(role, hasLeader)
    .map(getStageLabel)
    .join(" → ");
}

export function getLeaveStatusLabel(role: UserRole, hasLeader: boolean, status: LeaveStatus) {
  if (status === "REJECTED") {
    return "반려";
  }

  if (status === "PENDING") {
    const nextStage = getNextPendingStage(role, hasLeader, status);
    return nextStage ? `${getStageDescription(nextStage)} 대기` : "대기";
  }

  if (isFinalApprovedStatus(role, hasLeader, status)) {
    return "최종 승인";
  }

  const nextStage = getNextPendingStage(role, hasLeader, status);
  return nextStage ? `${getStageDescription(nextStage)} 대기` : "승인";
}
