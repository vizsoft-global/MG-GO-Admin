/**
 * Collection and field names for the Cloud Functions.
 *
 * These strings are duplicated from `src/lib/firebase/db.ts` on purpose: the
 * functions package builds and deploys from `functions/` with its own tsconfig
 * and `rootDir`, so importing across the package boundary would either fail the
 * build or silently widen `rootDir`. A typo here is not a type error — it is an
 * empty result that looks like "no rows yet" — so the names live in one file and
 * everything takes them from here.
 */
export const COLLECTIONS = {
  appSettings: "app_settings",
  profiles: "profiles",
  drivers: "drivers",
  driverIntakes: "driver_intakes",
  /** Compliance documents uploaded against a driver post-activation. */
  driverDocuments: "driver_documents",
  /** Inventory asset assignments (`asset_assignments`); catalogue is `asset_catalog`. */
  assetAssignments: "asset_assignments",
  deliveries: "deliveries",
  /** Written at verify / complete time. Not a history backfill. */
  rollupsDriverDay: "rollups_driver_day",
  rollupsZoneMonth: "rollups_zone_month",
  deliveryVerifications: "delivery_verifications",
  attendanceLogs: "attendance_logs",
  driverSessions: "driver_sessions",
  driverLocations: "driver_locations",
  driverLocationEvents: "driver_location_events",
  zones: "zones",
  partners: "partners",
  restaurants: "restaurants",
  driverRestaurants: "driver_restaurants",
  /** Add Driver / intake mappings. Live linked riders use `driver_restaurants`. */
  driverIntakeRestaurants: "driver_intake_restaurants",
  driverGroups: "driver_groups",
  /** Group membership junction. `driver_groups.member_ids` mirrors this. */
  driverGroupMembers: "driver_group_members",
  sourceCompanies: "source_companies",
  vehicles: "vehicles",
  fuelFills: "fuel_fills",
  wrongActions: "wrong_actions",
  documentTracking: "document_tracking",
  assetCatalog: "asset_catalog",
  adminRoles: "admin_roles",
  adminPermissions: "admin_permissions",
  adminRolePermissions: "admin_role_permissions",
  adminUserPermissions: "admin_user_permissions",
  authEpochs: "auth_epochs",
  driverEarningsDaily: "driver_earnings_daily",
  driverWalletEntries: "driver_wallet_entries",
  driverPayouts: "driver_payouts",
  payoutRuns: "payout_runs",
  driverDailyShifts: "driver_daily_shifts",
  /**
   * One read-only Home payload snapshot per rider per shift day
   * (`{driverId}_{shiftDate}`). Written by `rebuildDriverHomeDaily`; the Home
   * RPC serves it only while it is fresh and only under
   * `app_settings.home_snapshot_enabled`.
   */
  driverHomeDaily: "driver_home_daily",
  /**
   * One doc per rider (`{uid}`) holding change counters the rider app listens to
   * instead of polling. Server-written only; the rider reads its own doc.
   */
  riderSignals: "rider_signals",
  /** Per rider-day GPS totals written by the Worker flush (`{driverId}_{day}`). */
  riderDayStats: "rider_day_stats",
  driverOffStructure: "driver_off_structure",
  /** Operations-uploaded Invalid / Rejected / Cancelled rows, keyed `{driverId}_{day}`. */
  riderComplianceDaily: "rider_compliance_daily",
  orderReconRows: "order_recon_rows",
  orderReconRuns: "order_recon_runs",
  notificationCampaigns: "notification_campaigns",
  esignRequests: "esign_requests",
  visitBookings: "visit_bookings",
  deliveryRules: "delivery_rules",
  deliveryRuleScopes: "delivery_rule_scopes",
  incentiveRules: "incentive_rules",
  incentiveRuleTiers: "incentive_rule_tiers",
  incentiveRuleScopes: "incentive_rule_scopes",
  restaurantGeofences: "restaurant_geofences",
  payrollClients: "payroll_clients",
  payrollClientRules: "payroll_client_rules",
  payrollZoneMetrics: "payroll_zone_metrics",
  payrollZoneSettings: "payroll_zone_settings",
  payrollManualAdjustments: "payroll_manual_adjustments",
  payrollColumnConfig: "payroll_column_config",
  /** `payroll_rule_audit_logs` — the before/after trail behind the Settings tab. */
  payrollRuleAuditLogs: "payroll_rule_audit_logs",
  requests: "requests",
  requestTypeDefinitions: "request_type_definitions",
  requestFieldDefinitions: "request_field_definitions",
  loanTenureOptions: "loan_tenure_options",
  complaintCategories: "complaint_categories",
  requestApprovalSteps: "request_approval_steps",
  requestApprovalStepTemplates: "request_approval_step_templates",
  requestClarifications: "request_clarifications",
  requestAttachments: "request_attachments",
  requestComments: "request_comments",
  requestForwards: "request_forwards",
  requestDepartments: "request_departments",
  requestStaffAccess: "request_staff_access",
  esignStaffAccess: "esign_staff_access",
  requestExceptionActions: "request_exception_actions",
  esignCategories: "esign_categories",
  esignRequestSigners: "esign_request_signers",
  /** Rider- or admin-uploaded supporting documents, capped per request. */
  esignRequestAttachments: "esign_request_attachments",
  esignBatches: "esign_batches",
  esignBatchRows: "esign_batch_rows",
  esignDrafts: "esign_drafts",
  esignTemplates: "esign_templates",
  esignTemplateFields: "esign_template_fields",
  esignAuditEvents: "esign_audit_events",
  visitBranches: "visit_branches",
  visitDepartments: "visit_departments",
  visitSlots: "visit_slots",
  visitBookingNotes: "visit_booking_notes",
  visitBlockedDates: "visit_blocked_dates",
  notificationTemplates: "notification_templates",
  notificationEvents: "notification_events",
  /** Day x campaign funnel rollup; written from notification events (QA #24). */
  notificationAnalyticsDaily: "notification_analytics_daily",
  notificationDispatchRuns: "notification_dispatch_runs",
  notificationDispatchItems: "notification_dispatch_items",
  notificationAutomations: "notification_automations",
  notificationAutomationEvents: "notification_automation_events",
  notificationAudienceSnapshots: "notification_audience_snapshots",
  notificationClientEvents: "notification_client_events",
  notificationDeviceTokens: "notification_device_tokens",
  /** Rider FCM tokens. Admin SDK / rider callables only — rules deny client writes. */
  driverPushTokens: "driver_push_tokens",
  notificationTimeline: "notification_timeline",
  driverPerformanceDaily: "driver_performance_daily",
  performanceScoreComponents: "performance_score_components",
  performanceRatingCriteria: "performance_rating_criteria",
  driverPerformanceRatings: "driver_performance_ratings",
  driverPerformanceRatingNotes: "driver_performance_rating_notes",
  performanceRatingTeamMembers: "performance_rating_team_members",
  /**
   * Per-restaurant (or zone / partner) daily DPD target, read by the driver-level
   * resolver. Same shape the earnings engine already reads: `target_dpd` per
   * scope key.
   */
  performanceTargetDpd: "performance_target_dpd",
  /**
   * The rider's own account of a rejected / cancelled order, with proof and a
   * mandatory reason. One row per reported case; the admin verdict rides on the
   * row and never rewrites `deliveries`.
   */
  orderExceptions: "order_exceptions",
  /**
   * The persisted month-to-date level verdict, `{driverId}_{YYYY-MM}`.
   *
   * The panel and the app compute the level live; this collection exists so a
   * rider becoming D is a *transition* that can be detected and notified once,
   * rather than a state re-announced on every sweep.
   */
  driverLevelSnapshots: "driver_level_snapshots",
  driverDeviceSessions: "driver_device_sessions",
  driverOperationEvents: "driver_operation_events",
  driverTelemetryEvents: "driver_telemetry_events",
  fleetEvents: "fleet_events",
  vehicleUseTypes: "vehicle_use_types",
  employeeStatuses: "employee_statuses",
  employeeSections: "employee_sections",
  nationalityCategories: "nationality_categories",
  bankCodes: "bank_codes",
  adminActivityLogs: "admin_activity_logs",
  counters: "counters",
} as const;

/** Uniqueness lock documents — partial unique indexes become these. */
export const UNIQUE_LOCKS = {
  employeeId: "uniq_employee_id",
  phone: "uniq_phone",
  civilId: "uniq_civil_id",
  passport: "uniq_passport",
  plate: "uniq_plate",
  passcode: "uniq_passcode",
} as const;

/**
 * Field names, grouped per document shape.
 *
 * Kept beside the collection names because a renamed field is the same class of
 * silent failure: `where("deliveredAt", ...)` against a document that stores
 * `delivered_at` returns nothing and reports no error.
 */
export const FIELDS = {
  deliveries: {
    status: "status",
    /** Firestore Timestamp — the range field for a windowed query. */
    createdAt: "created_at",
    deliveredAt: "delivered_at",
    pickupAt: "pickup_at",
    /** `YYYY-MM-DD` in Asia/Kuwait, stored at write time. */
    shiftDate: "shift_date",
    createdDay: "created_day",
    deliveredDay: "delivered_day",
    zoneId: "zone_id",
    partnerId: "partner_id",
    restaurantId: "restaurant_id",
    driverId: "driver_id",
    /** Denormalised so a list row never has to join `drivers`. */
    driverName: "driver_name",
    driverCode: "driver_code",
  },
  attendanceLogs: {
    driverId: "driver_id",
    logDate: "log_date",
    status: "status",
    checkInAt: "check_in_at",
    checkOutAt: "check_out_at",
    checkOutReason: "check_out_reason",
    minutesLate: "minutes_late",
    scheduledStartAt: "scheduled_start_at",
    scheduledEndAt: "scheduled_end_at",
    workedMinutes: "worked_minutes",
    zoneId: "zone_id",
    zoneName: "zone_name",
    partnerId: "partner_id",
    partnerName: "partner_name",
    /** Every partner this rider can be filtered by: their own id, plus the
     * partner whose slug equals their `project_key`. */
    partnerMatchKeys: "partner_match_keys",
    /** Every restaurant the rider is assigned to — the array-contains filter. */
    restaurantIds: "restaurant_ids",
    driverName: "driver_name",
    driverCode: "driver_code",
    driverPhone: "driver_phone",
    employeeId: "employee_id",
    attendanceLogId: "attendance_log_id",
    shiftType: "shift_type",
    onlineSeconds: "online_seconds",
    isOnDuty: "is_on_duty",
    liveStatus: "live_status",
    complianceScore: "compliance_score",
  },
  drivers: {
    id: "id",
    name: "name",
    employeeId: "employee_id",
    driverCode: "driver_code",
    zoneId: "zone_id",
    zoneName: "zone_name",
    partnerId: "partner_id",
    restaurantId: "restaurant_id",
    status: "status",
    nationality: "nationality",
    sourceCompany: "source_company",
    projectKey: "project_key",
    vehicleId: "vehicle_id",
    archivedAt: "archived_at",
  },
  driverLocations: {
    driverId: "driver_id",
    /** `YYYY-MM-DD` in Asia/Kuwait — the history partition. */
    day: "day",
    lat: "lat",
    lng: "lng",
    at: "at",
    /** History rows (`driver_location_events`) carry the fix time here, not in `at`. */
    recordedAt: "recorded_at",
    accuracyMeters: "accuracy_meters",
    speedMps: "speed_mps",
    /** Maintained odometer, the single "distance today" number. */
    distanceTodayMeters: "distance_today_meters",
  },
  profiles: {
    role: "role",
    adminRoleId: "admin_role_id",
    approvalStatus: "approval_status",
    archivedAt: "archived_at",
  },
} as const;

/** Delivery statuses, mirroring the `delivery_status` enum. */
export const DELIVERY_STATUSES = [
  "pending",
  "in_transit",
  "under_review",
  "verified",
  "rejected",
  "cancelled",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** The three statuses the panel calls "in progress". */
export const IN_PROGRESS_STATUSES: readonly DeliveryStatus[] = [
  "in_transit",
  "pending",
  "under_review",
];
