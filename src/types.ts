export type UserRole = "USER" | "LEADER" | "HR" | "ADMIN" | "DIRECTOR";
export type LeaveType = "ANNUAL" | "HALF_AM" | "HALF_PM" | "SICK";
export type LeaveStatus = "PENDING" | "APPROVED_LEADER" | "APPROVED_HR" | "APPROVED_DIRECTOR" | "REJECTED";
export type OrgUnitType = "ROOT" | "DIVISION" | "TEAM";

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

export interface OrgUnitItem {
  id: number;
  name: string;
  unitType: OrgUnitType;
  parentId: number | null;
  path: string[];
}

export interface ManagedEmployeeItem {
  id: number;
  employeeNo: string;
  name: string;
  email: string;
  role: UserRole;
  joinedAt: string;
  retiredAt: string | null;
  isActive: boolean;
  orgUnitId: number | null;
  teamName: string;
  orgPath: string[];
  leaderId: number | null;
  leaderName: string | null;
}

export interface EmployeeUpdateInput {
  joinedAt: string;
  retiredAt: string | null;
  orgUnitId: number | null;
  leaderId: number | null;
  isActive: boolean;
  password?: string;
}

export interface EmployeeCreateInput {
  employeeNo: string;
  name: string;
  email: string;
  password: string;
  joinedAt: string;
  role: UserRole;
  orgUnitId: number | null;
  leaderId: number | null;
  isActive: boolean;
}

export interface EmployeeLeaveExportItem {
  employeeNo: string;
  name: string;
  joinedAt: string;
  entitlement: number;
  used: number;
  remaining: number;
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
}
