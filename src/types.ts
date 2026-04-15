export type UserRole = "USER" | "LEADER" | "HR" | "ADMIN" | "DIRECTOR";
export type LeaveType = "ANNUAL" | "HALF_AM" | "HALF_PM" | "SICK";
export type LeaveStatus = "PENDING" | "APPROVED_LEADER" | "APPROVED_HR" | "APPROVED_DIRECTOR" | "REJECTED";

export interface SessionUser {
  id: number;
  employeeNo: string;
  name: string;
  email: string;
  role: UserRole;
  orgPath: string[];
  teamName: string;
  joinedAt: string;
}

export interface LeaveSummary {
  cycleStart: string;
  cycleEnd: string;
  entitlement: number;
  used: number;
  pending: number;
  remaining: number;
  serviceYears: number;
  joinedAt: string;
}

export interface LeaveRequestItem {
  id: number;
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  teamName: string;
  requesterRole: UserRole;
  requesterHasLeader: boolean;
  type: LeaveType;
  startDate: string;
  endDate: string;
  amount: number;
  reason: string;
  status: LeaveStatus;
  createdAt: string;
  leaderName?: string | null;
  hrName?: string | null;
  directorName?: string | null;
}

export interface LeaveRequestInput {
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
}

export interface ApprovalActionInput {
  requestId: number;
  action: "APPROVE" | "REJECT";
  note?: string;
}

export interface AuthResponse {
  user: SessionUser;
}

export interface NoticeItem {
  id: number;
  title: string;
  content: string;
  authorName: string;
  authorRole: UserRole;
  createdAt: string;
}
