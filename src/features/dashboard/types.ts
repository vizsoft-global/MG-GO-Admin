export type DashboardPermissions = {
  drivers: boolean;
  deliveries: boolean;
  earnings: boolean;
  attendance: boolean;
  verifications: boolean;
  audit: boolean;
  superAdmin: boolean;
};

export type DashboardKpis = {
  pendingAccessRequests: number;
  verificationBacklog: number;
  deliveryReviewPending: number;
  payrollBlockers: number;
  driverExceptions: number;
  absentToday: number;
};

export type AccessRequestRow = {
  id: string;
  email: string | null;
  fullName: string | null;
  createdAt: string;
  ageBucket: "fresh" | "waiting" | "stale";
};

export type AdminActionItem = {
  id: string;
  severity: "info" | "warning" | "danger";
  category: "access" | "verification" | "delivery" | "payroll" | "attendance" | "driver";
  titleKey: AdminActionTitleKey;
  detail: string;
  href: string;
  at: string;
};

export type AdminActionTitleKey =
  | "accessPending"
  | "verificationNotReported"
  | "deliveryUnderReview"
  | "payrollAnomaly"
  | "driverSilent"
  | "driverMissingAttendance"
  | "driverSuspended";

export type PayrollReadinessSummary = {
  readyCount: number;
  blockedCount: number;
  anomalyCount: number;
  totalEstimatedKwd: number;
  rows: EarningsWatchRow[];
};

export type SystemStatusSummary = {
  maintenanceMode: boolean;
};

export type WorkforceStatus =
  | "online"
  | "working"
  | "silent"
  | "missing"
  | "suspended"
  | "awaiting_verification";

export type WorkforceQueueRow = {
  driverId: string;
  linkedProfileId: string | null;
  driverName: string;
  driverCode: string;
  partnerName: string;
  restaurantName: string;
  zoneName: string;
  status: WorkforceStatus;
  shiftLabel: string;
  deliveriesToday: number;
  lastActivityAt: string | null;
  lastGpsAt?: string | null;
  zoneStatus?: string | null;
  trackingStatus?: string | null;
  alerts: string[];
};

export type DeliveryMonitorMetrics = {
  submittedToday: number;
  pending: number;
  verified: number;
  rejected: number;
  underReview: number;
  spikeDetected: boolean;
  avgLast7Days: number;
};

export type DeliveryFeedItem = {
  id: string;
  at: string;
  driverName: string;
  messageKey: DeliveryFeedMessageKey;
  detail: string;
  severity: "info" | "warning" | "danger" | "success";
};

export type DeliveryFeedMessageKey =
  | "submitted"
  | "verified"
  | "rejected"
  | "underReview"
  | "verificationPending"
  | "payoutRecalculated";

export type EarningsAnomaly =
  | "high_payout"
  | "zero_earnings"
  | "delivery_mismatch";

export type EarningsWatchRow = {
  driverId: string;
  driverName: string;
  driverCode: string;
  deliveries: number;
  ruleLabel: string;
  incentiveKwd: number;
  estimatedKwd: number;
  anomalies: EarningsAnomaly[];
};

export type AttendanceMonitorRow = {
  partnerName: string;
  scheduled: number;
  checkedIn: number;
  late: number;
  absent: number;
  overtime: number;
};

export type PartnerHealthCard = {
  partnerId: string;
  partnerName: string;
  assignedRiders: number;
  activeToday: number;
  missingAttendance: number;
  pendingVerification: number;
  restaurants: {
    restaurantId: string;
    restaurantName: string;
    riderCount: number;
    understaffed: boolean;
    inactiveCount: number;
  }[];
};

export type PresenceMapPin = {
  id: string;
  driverName: string;
  lat: number;
  lng: number;
  status: "active" | "idle" | "alert";
  lastSeenAt: string;
  restaurantName: string;
  outOfZone: boolean;
  gpsInactive: boolean;
};

export type PresenceMapZone = {
  id: string;
  name: string;
  color: string;
};

export type PresenceMapRestaurant = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
};

export type AlertCenterItem = {
  id: string;
  severity: "info" | "warning" | "danger";
  messageKey: AlertMessageKey;
  detail: string;
  at: string;
  isLive: boolean;
};

export type AlertMessageKey =
  | "noSubmissionToday"
  | "inactiveHours"
  | "outsideZone"
  | "deliveryAnomaly"
  | "missingAttendance"
  | "verificationBacklog"
  | "incentiveFailure"
  | "gpsStale";

export type ComplianceItem = {
  id: string;
  driverName: string;
  driverCode: string;
  issueKey: ComplianceIssueKey;
  detail: string;
  severity: "warning" | "danger";
};

export type ComplianceIssueKey =
  | "docExpiring"
  | "missingDocs"
  | "licenseExpiry"
  | "passcodeDisabled"
  | "appOutdated"
  | "noGps"
  | "appInactive"
  | "lowBattery";

export type DashboardSnapshot = {
  fetchedAt: string;
  today: string;
  permissions: DashboardPermissions;
  kpis: DashboardKpis;
  accessRequests: AccessRequestRow[];
  adminActionQueue: AdminActionItem[];
  payrollReadiness: PayrollReadinessSummary;
  systemStatus: SystemStatusSummary;
  workforceQueue: WorkforceQueueRow[];
  deliveryMetrics: DeliveryMonitorMetrics;
  deliveryFeed: DeliveryFeedItem[];
  earningsWatch: EarningsWatchRow[];
  attendanceMonitor: AttendanceMonitorRow[];
  partnerHealth: PartnerHealthCard[];
  presenceZones: PresenceMapZone[];
  presenceRestaurants: PresenceMapRestaurant[];
};
