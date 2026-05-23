export type UserRole = "USER" | "LEADER" | "HR" | "ADMIN" | "DIRECTOR";
export type LeaveType = "ANNUAL" | "HALF_AM" | "HALF_PM" | "SICK" | "UNPAID";
export type LeaveStatus = "PENDING" | "APPROVED_LEADER" | "APPROVED_HR" | "APPROVED_DIRECTOR" | "REJECTED" | "CANCELLED";
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
  approvedLeaderId?: number | null;
  approvedHrId?: number | null;
  approvedDirectorId?: number | null;
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
  action: "APPROVE" | "REJECT" | "CANCEL";
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
  leaveAdjustmentDays: number;
  leaveAdjustmentCycleStart?: string | null;
  updatedAt?: string;
  leaveEntitlementDays?: number;
  usedLeaveDays?: number;
  pendingLeaveDays?: number;
  remainingLeaveDays?: number;
  leaveBaseRemainingDays?: number;
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
  role: UserRole;
  orgUnitId: number | null;
  leaderId: number | null;
  leaveAdjustmentDays: number;
  targetRemainingDays?: number;
  adjustmentReason?: string;
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

export interface DiceRecentRollItem {
  id: number;
  rollDate: string;
  rollValue: number;
  dieOne: number;
  dieTwo: number;
  isDouble: boolean;
  rollScore: number;
  source: "DAILY" | "BONUS";
  createdAt: string;
}

export interface DiceStatus {
  today: string;
  normalAvailable: boolean;
  regularAvailable: number;
  nextRegularRollDate: string | null;
  bonusAvailable: number;
  totalAvailable: number;
  todayBestScore: number;
  todayAttempts: number;
  recentRolls: DiceRecentRollItem[];
}

export interface DiceRollItem {
  id: number;
  rollDate: string;
  rollValue: number;
  dieOne: number;
  dieTwo: number;
  isDouble: boolean;
  rollScore: number;
  source: "DAILY" | "BONUS";
}

export interface DiceRankingItem {
  employeeNo: string;
  employeeName: string;
  score: number;
  rolls: number;
  rank: number;
}

export interface DiceRanking {
  monthStart: string;
  top3: DiceRankingItem[];
  me: {
    employeeNo: string;
    employeeName: string;
    score: number;
    rolls: number;
    rank: number | null;
  };
}

export interface DiceRollResponse {
  roll: DiceRollItem;
  status: DiceStatus;
  ranking: DiceRanking;
}
