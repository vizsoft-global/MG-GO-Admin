/**
 * Firestore collection names for musallam-delivery-prod.
 *
 * The strings are centralised because a typo in a collection name is not a type
 * error — it is a silently empty read that looks exactly like "no rows yet".
 * Anything that wants a collection name takes it from here.
 *
 * Shape authority: the migration plan's data-load section. Root collections for
 * entities the admin filters across; subcollections only for true children;
 * denormalised list fields on the parent (driver name/code onto deliveries);
 * `uniq_*` lock docs for the partial unique indexes; `counters/{name}` for the
 * eight code sequences. Kuwait-day values are stored as `YYYY-MM-DD` strings.
 */
export const COLLECTIONS = {
  appSettings: "app_settings",
  profiles: "profiles",
  drivers: "drivers",
  driverIntakes: "driver_intakes",
  deliveries: "deliveries",
  vehicles: "vehicles",
  requests: "requests",
  restaurants: "restaurants",
  zones: "zones",
  partners: "partners",
  attendanceLogs: "attendance_logs",
  driverSessions: "driver_sessions",
  esignRequests: "esign_requests",
  visitBookings: "visit_bookings",
  driverLocations: "driver_locations",
  fleetEvents: "fleet_events",
  driverEarningsDaily: "driver_earnings_daily",
  driverPayouts: "driver_payouts",
  driverWalletEntries: "driver_wallet_entries",
  notifications: "notifications",
  driverDocuments: "driver_documents",
  assetAssignments: "asset_assignments",
  deliveryVerifications: "delivery_verifications",
  driverLocationEvents: "driver_location_events",
  driverRestaurants: "driver_restaurants",
  driverGroups: "driver_groups",
  sourceCompanies: "source_companies",
  fuelFills: "fuel_fills",
  wrongActions: "wrong_actions",
  documentTracking: "document_tracking",
  assetCatalog: "asset_catalog",
  payoutRuns: "payout_runs",
  driverDailyShifts: "driver_daily_shifts",
  driverOffStructure: "driver_off_structure",
  orderReconRows: "order_recon_rows",
  orderReconRuns: "order_recon_runs",
  notificationCampaigns: "notification_campaigns",
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
  payrollRuleAuditLogs: "payroll_rule_audit_logs",
  requestTypeDefinitions: "request_type_definitions",
  requestFieldDefinitions: "request_field_definitions",
  requestApprovalSteps: "request_approval_steps",
  requestApprovalStepTemplates: "request_approval_step_templates",
  requestClarifications: "request_clarifications",
  requestAttachments: "request_attachments",
  requestComments: "request_comments",
  requestForwards: "request_forwards",
  requestDepartments: "request_departments",
  requestStaffAccess: "request_staff_access",
  requestExceptionActions: "request_exception_actions",
  esignCategories: "esign_categories",
  esignRequestSigners: "esign_request_signers",
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
  notificationDispatchRuns: "notification_dispatch_runs",
  notificationDispatchItems: "notification_dispatch_items",
  notificationAutomations: "notification_automations",
  notificationAutomationEvents: "notification_automation_events",
  notificationAudienceSnapshots: "notification_audience_snapshots",
  notificationClientEvents: "notification_client_events",
  notificationDeviceTokens: "notification_device_tokens",
  notificationTimeline: "notification_timeline",
  driverPerformanceDaily: "driver_performance_daily",
  performanceScoreComponents: "performance_score_components",
  performanceRatingCriteria: "performance_rating_criteria",
  driverPerformanceRatings: "driver_performance_ratings",
  driverPerformanceRatingNotes: "driver_performance_rating_notes",
  performanceRatingTeamMembers: "performance_rating_team_members",
  driverDeviceSessions: "driver_device_sessions",
  driverOperationEvents: "driver_operation_events",
  driverTelemetryEvents: "driver_telemetry_events",
  vehicleUseTypes: "vehicle_use_types",
  vehicleTypes: "vehicle_types",
  menuConfigs: "menu_configs",
  locales: "locales",
  supportThreads: "support_threads",
  supportMessages: "support_messages",
  adminPermissions: "admin_permissions",
  adminRoles: "admin_roles",
  adminRolePermissions: "admin_role_permissions",
  adminUserPermissions: "admin_user_permissions",
  adminAllowlist: "admin_allowlist",
  adminActivityLogs: "admin_activity_logs",
  counters: "counters",
} as const;

/** The single doc that carries app-wide switches (branding, maintenance, force update). */
/** Named Firestore database on musallam-delivery-prod (Enterprise, me-central2). */
export const FIRESTORE_DATABASE_ID = "default";

export const APP_SETTINGS_DOC_ID = "1";

/** The doc holding the permission catalog slug list. */
export const PERMISSION_CATALOG_DOC_ID = "catalog";

/** Lock collections that stand in for the partial unique indexes. */
export const UNIQ_COLLECTIONS = {
  employeeId: "uniq_employee_id",
  phone: "uniq_phone",
  civilId: "uniq_civil_id",
  plate: "uniq_plate",
  passcode: "uniq_passcode",
} as const;

/** The eight code sequences, seeded from the SQL sequence values in the dump. */
export const COUNTER_NAMES = [
  "driver_code_seq",
  "restaurant_code_seq",
  "request_code_seq",
  "visit_booking_code_seq",
  "esign_code_seq",
  "appointment_code_seq",
  "fuel_refund_code_seq",
  "esign_batch_code_seq",
] as const;

export type CounterName = (typeof COUNTER_NAMES)[number];

/**
 * A Kuwait calendar day as the string Firestore stores and every query filters
 * on. Stored, never derived at read time: a converted timestamp cannot be
 * range-filtered cheaply, and the 05:00 operational day is not a timezone rule.
 */
export function kuwaitDayString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}
