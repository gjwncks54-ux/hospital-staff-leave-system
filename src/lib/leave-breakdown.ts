import { isFinalApprovedStatus } from "./approval-flow";
import type { LeaveRequestItem } from "../types";

export function splitOwnLeaveHistory(items: LeaveRequestItem[], employeeId: number, today: string) {
  const used: LeaveRequestItem[] = [];
  const pending: LeaveRequestItem[] = [];

  for (const item of items) {
    if (item.employeeId !== employeeId || item.type === "SICK" || item.type === "UNPAID" || item.status === "REJECTED" || item.status === "CANCELLED") {
      continue;
    }

    if (isFinalApprovedStatus(item.requesterRole, item.requesterHasLeader, item.status) && item.startDate <= today) {
      used.push(item);
    } else {
      pending.push(item);
    }
  }

  return { used, pending };
}
