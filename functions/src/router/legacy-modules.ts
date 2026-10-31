/**
 * Legacy callable modules. Keys are the require() path from functions/src/index.ts
 * (and from functions/lib/index.js after tsc). FUNCTION_TARGET loads one module.
 * The router loads one entry per request.
 */
export const LEGACY_MODULES: Readonly<Record<string, readonly string[]>> = {
  "./rpcs/deliveries-counts": [
    "adminDeliveriesStatusCounts",
    "adminDeliveriesCountsByFilters"
  ],
  "./rpcs/deliveries-status": [
    "adminBulkUpdateDeliveries"
  ],
  "./rpcs/attendance": [
    "adminListAttendanceDaily",
    "adminAttendanceKpis"
  ],
  "./rpcs/day-route": [
    "adminGetDriverDayRoute"
  ],
  "./rpcs/payroll": [
    "adminPayrollRuleSnapshot"
  ],
  "./rpcs/earnings": [
    "adminIncentiveDailyReport",
    "listDriverEarningsDaily",
    "recalculateDriverEarnings",
    "recalculateEarningsForDate",
    "recalculateEarningsForRange",
    "getDriverEarningsDetail",
    "previewDriverEarnings"
  ],
  "./rpcs/purge": [
    "adminPurgeFilterColumns",
    "adminPurgePreviewAll",
    "adminPurgeFilteredValues",
    "adminPurgeFilteredPreview",
    "adminPurgeFilteredPage"
  ],
  "./rpcs/purge-all": [
    "adminPurgeRunAll",
    "adminPurgeFilteredRun",
    "adminPreviewPurge",
    "adminPurgeDeliveries",
    "adminPurgeDrivers",
    "adminPurgeIntakes",
    "adminPurgeRestaurants",
    "adminPurgeZones",
    "adminPurgeDeliveryRules",
    "adminPurgeIncentiveRules",
    "adminPurgeAssetCatalog"
  ],
  "./rpcs/ops": [
    "adminPerformanceOpsBounds",
    "adminListPerformanceTargetDpd",
    "adminUpsertPerformanceTargetDpd",
    "adminDpdLiveSnapshot",
    "adminDpdNoticeCandidates",
    "adminDpdEfficiencySnapshot",
    "adminPerformanceOpsSnapshot",
    "claimDpdShiftNotice"
  ],
  "./rpcs/fleet": [
    "adminLiveFleetSnapshot",
    "adminListFleetEvents"
  ],
  "./rpcs/fleet-worker-http": [
    "adminIngestDriverPositions",
    "adminRecordFleetEvents",
    "workerFleetRead"
  ],
  "./rpcs/bites-live-ticket": [
    "bitesFleetSocketTicket"
  ],
  "./rpcs/bites-backfill": [
    "adminBackfillBitesMirror"
  ],
  "./rpcs/bites-reconcile": [
    "bitesMirrorSweep"
  ],
  "./rpcs/delivery-context-sweep": [
    "deliveryProximitySweep"
  ],
  "./rpcs/delivery-context-refresh": [
    "adminRefreshDeliveryContext"
  ],
  "./rpcs/home-snapshot-repair": [
    "homeSnapshotRepair"
  ],
  "./rpcs/bites-push": [
    "adminSyncBitesMirror"
  ],
  "./rpcs/performance-extra": [
    "adminListPerformanceComponents",
    "adminUpdatePerformanceComponents",
    "adminListPerformanceRatingTeams",
    "adminDeleteDriverPerformanceRating",
    "adminRunPerformanceDailyRollup",
    "adminDriverPerformanceDaily"
  ],
  "./rpcs/visits": [
    "adminListVisits",
    "adminUpdateVisitStatus",
    "adminRescheduleVisit",
    "adminSetVisitNoteToRider",
    "adminSyncBranchSlotsToWorkingDays"
  ],
  "./rpcs/catalogs": [
    "adminUpsertZone",
    "adminDeleteZone",
    "adminUpsertPartner",
    "adminDeletePartner",
    "adminUpsertRestaurant",
    "adminDeleteRestaurant",
    "adminUpsertVehicleType",
    "adminUpsertVehicleUseType",
    "adminUpsertVehicleCompany",
    "adminUpsertAssetCatalog",
    "adminDeleteAssetCatalog",
    "adminAdjustAssetStock",
    "adminReturnAssetAssignment",
    "adminUpsertCustomFieldDefinition",
    "adminReorderCustomFieldDefinitions",
    "adminDeleteCustomFieldDefinition",
    "adminUpsertLoanTenureOption",
    "adminDeleteLoanTenureOption",
    "adminUpsertComplaintCategory",
    "adminDeleteComplaintCategory",
    "adminUpsertEmployeeCatalog"
  ],
  "./rpcs/employees-dashboard": [
    "adminEmployeesDashboard"
  ],
  "./rpcs/leave-plans": [
    "adminListLeavePlans",
    "adminUpsertLeavePlan",
    "adminDeleteLeavePlan",
    "adminSetLeavePlanStatus",
    "adminImportLeavePlans"
  ],
  "./rpcs/operations-dashboard": [
    "adminOperationsDashboard",
    "adminClientPortalDashboard"
  ],
  "./rpcs/rules": [
    "adminInsertDeliveryRuleWithScope",
    "adminUpsertSourceCompany",
    "adminUpsertDeliveryRule",
    "adminDeleteDeliveryRule",
    "adminListDeliveryRules",
    "adminBulkUpdateDeliveryRules",
    "adminUpsertIncentiveRule",
    "adminDeleteIncentiveRule",
    "adminListIncentiveRules",
    "adminExportIncentiveRules",
    "adminUpsertExceptionAction"
  ],
  "./rpcs/payroll-clients": [
    "adminPayrollRuleConfig",
    "adminOpenPayrollRuleMonth",
    "adminSavePayrollClient",
    "adminSavePayrollClientRules",
    "adminResetPayrollClientRules",
    "adminAddPayrollClient",
    "adminDeletePayrollClient",
    "adminListPayrollColumnConfig",
    "adminSetPayrollColumnConfig"
  ],
  "./rpcs/retention": [
    "claimDriverImportChunk",
    "cleanupDriverLocationEvents",
    "cleanupDriverOperationEvents",
    "cleanupDriverTelemetryEvents",
    "cleanupStaleDriverLocations"
  ],
  "./rpcs/perf-ping": [
    "adminPerfPing"
  ],
  "./rpcs/drivers": [
    "adminListDriversPage",
    "adminDriversFilterValues",
    "setDriverAccountStatus",
    "setDriverBlocked",
    "setDriverFrozen",
    "setDriverUnfrozen",
    "adminDriverAppInstallVersions"
  ],
  "./rpcs/drivers-admin": [
    "adminApproveDriver",
    "allocateDriverCode",
    "archiveDriverIntake",
    "restoreDriverIntake",
    "regenerateDriverAppPasscode",
    "intakeHasOpsAssignment",
    "adminSetDriverOffStructure",
    "adminBulkSetDriverOffStructure"
  ],
  "./rpcs/driver-devices": [
    "adminListDriverDevices",
    "adminDriverDeviceOverview",
    "adminDriversMultiDeviceRecent",
    "adminForceSignOutDriver",
    "adminSetDriverForceUpdate",
    "driverRecordAppVersion"
  ],
  "./rpcs/misc-admin": [
    "driverListNotifications",
    "driverMarkNotificationsRead",
    "driverDismissNotifications",
    "notifyDriverTransactional",
    "adminExpireStalePickups",
    "driverOpsAuditHealth"
  ],
  "./rpcs/fuel": [
    "adminListFuelFills",
    "adminSetFuelTransferType"
  ],
  "./rpcs/notifications": [
    "enqueueNotificationAutomationEvent",
    "recordNotificationClientEvent"
  ],
  "./rpcs/notification-audience": [
    "resolveImportDriverIds",
    "estimateNotificationAudience",
    "compileNotificationAudienceIds",
    "compileNotificationAudience"
  ],
  "./rpcs/requests-core": [
    "adminListRequests",
    "adminGetRequest",
    "adminCreateRequest",
    "adminCountRequestsByType",
    "adminRequestsTrend",
    "adminRequestDepartmentReport"
  ],
  "./rpcs/requests-workflow": [
    "adminDecideRequest",
    "adminForwardRequest",
    "adminEscalateRequest",
    "adminAddRequestComment",
    "adminSetRequestDecisionMeta",
    "adminUpsertStepTemplate",
    "adminAutoCloseRequests",
    "adminRunRequestSlaSweep",
    "adminUploadIncomingDocument"
  ],
  "./rpcs/esign-requests": [
    "esignEmployeeSnapshot",
    "adminExpireEsignRequests",
    "adminListEsignRequests",
    "adminCreateEsignRequest",
    "adminAddEsignAttachment",
    "adminRemoveEsignAttachment",
    "adminDecideEsignRequest",
    "adminRemindEsignRequests",
    "adminEsignReminderState",
    "adminLinkEsignResend",
    "adminUpsertEsignTemplate",
    "adminUpsertEsignTemplateField"
  ],
  "./rpcs/esign-compose": [
    "esignComposeSignedDocument"
  ],
  "./rpcs/esign-signers": [
    "adminListEsignSigners",
    "adminEsignSignerOptions",
    "adminAddEsignSigner",
    "adminRemoveEsignSigner",
    "adminReorderEsignSigners",
    "adminListMyEsignSignatures",
    "adminSubmitEsignSignature",
    "adminDeclineEsignSignature"
  ],
  "./rpcs/esign-batches": [
    "adminCreateEsignBatch",
    "adminEsignBatchKpis",
    "adminUpdateEsignBatchRow",
    "adminRemoveEsignBatchRow",
    "esignWorkerDrainableBatches",
    "adminEsignResolveEmployees",
    "esignWorkerResolveEmployees",
    "adminSaveEsignDraft",
    "adminListEsignDrafts",
    "adminGetEsignDraft",
    "adminDeleteEsignDraft"
  ],
  "./rpcs/attendance-ops": [
    "adminAttendanceAnalyticsDaily",
    "adminCorrectAttendance",
    "adminGetShiftAdherence",
    "adminListShiftAdherence",
    "adminListAttendanceExceptions",
    "adminRunAttendanceAutoCheckout",
    "adminRunFreezeStartCheckout"
  ],
  "./rpcs/payroll-more": [
    "adminApplyPayrollAdjustments",
    "adminPayrollAdjustmentAudit",
    "adminPayrollMonthSnapshot",
    "adminPayrollZoneSettings",
    "adminSavePayrollZoneSettings",
    "adminSavePayrollZoneOverride",
    "adminRecomputePayrollZoneMetrics"
  ],
  "./rpcs/payroll-edits": [
    "adminSavePayrollIdentity",
    "adminSavePayrollOrders",
    "adminListPayrollRiderStatuses",
    "adminSavePayrollRiderStatus"
  ],
  "./rpcs/hr-payroll": [
    "adminHrPayrollSnapshot",
    "adminSaveHrPayrollCells"
  ],
  "./rpcs/payouts": [
    "getEarningsOverview",
    "listEarningsGrouped",
    "generatePayoutRun",
    "approvePayoutRun",
    "markPayoutRunPaid",
    "voidPayoutRun",
    "getPayoutRunDetail"
  ],
  "./rpcs/recon-reports": [
    "adminOrderComparisonSnapshot",
    "adminOrderReconCompare",
    "reconcileDeliveryVerification",
    "deliveryMatchesRules",
    "reportDeliveryOrders"
  ],
  "./rpcs/performance-ratings": [
    "adminUpsertDriverPerformanceRating",
    "adminSetDriverPerformanceRatingNote",
    "adminListDriverPerformanceRatings",
    "adminSetPerformanceTeamMember",
    "adminUpsertPerformanceRatingCriterion",
    "adminDeletePerformanceRatingCriterion"
  ],
  "./rpcs/performance-list": [
    "adminListDriverPerformance",
    "adminPerformanceTrend"
  ],
  "./rpcs/driver-auth": [
    "driverPasscodeLogin",
    "driverReleaseDeviceSession",
    "driverHeartbeat"
  ],
  "./rpcs/driver-home": [
    "driverGetHomeDashboard",
    "driverSetDutyState",
    "driverCheckInContext"
  ],
  "./rpcs/driver-shift": [
    "driverGetTodayShift",
    "driverSubmitDailyShift"
  ],
  "./rpcs/driver-pay": [
    "driverGetPayCalculator",
    "adminNotifyComplianceRefresh"
  ],
  "./rpcs/driver-deliveries": [
    "driverGetActivePickup",
    "driverCreatePickup",
    "driverCompleteDelivery",
    "driverCancelDelivery",
    "driverGetDeliveryProximityContext"
  ],
  "./rpcs/driver-location": [
    "driverReportLocation",
    "driverClearLiveLocation"
  ],
  "./rpcs/driver-requests": [
    "driverListMyRequests",
    "driverGetRequest",
    "driverCreateRequest",
    "driverSubmitClarification",
    "driverClarifyRequest",
    "driverAcknowledgeRequest",
    "driverRespondReschedule"
  ],
  "./rpcs/driver-visits": [
    "driverListVisitSlots",
    "driverBookVisit",
    "driverCancelVisit"
  ],
  "./rpcs/driver-esign": [
    "driverListEsignRequests",
    "driverGetEsignRequest",
    "driverAddEsignAttachment",
    "driverSubmitEsignature",
    "driverMarkEsignViewed",
    "driverDeclineEsignature",
    "driverListAppointments",
    "driverRespondAppointment"
  ],
  "./rpcs/driver-earnings": [
    "driverGetEarningsSummary",
    "driverGetWorkSummary",
    "driverGetExtraEarnings",
    "driverGetEarningsDetail"
  ],
  "./rpcs/driver-vehicle": [
    "driverGetAssignedVehicle",
    "driverReportFuelFill"
  ],
  "./rpcs/driver-telemetry": [
    "driverIngestTelemetry"
  ],
  "./rpcs/driver-profile": [
    "driverUpdateAvatar",
    "driverReportDeviceMeta",
    "driverRecordLoginVerification"
  ],
  "./rpcs/driver-push-tokens": [
    "driverUpsertPushToken",
    "driverDeactivatePushToken"
  ],
  "./rpcs/driver-attendance-get": [
    "driverGetAttendance"
  ],
  "./rpcs/driver-security": [
    "driverLogSecurityEvent"
  ],
  "./rpcs/driver-lists": [
    "driverListMyDeliveries",
    "driverListEarningsDaily",
    "driverListPayouts",
    "driverListRequestTypes",
    "driverListRequestFields",
    "driverListTenureOptions",
    "driverListComplaintCategories",
    "driverGetDefaultVisitBranch",
    "driverListVisitDepartments",
    "driverListMyVisits"
  ],
  "./rpcs/driver-storage": [
    "driverGetUploadUrl",
    "driverGetDownloadUrl"
  ],
  "./rpcs/sync-staff-claims": [
    "syncStaffClaims"
  ],
  "./rpcs/order-exceptions": [
    "driverSubmitOrderException",
    "driverListMyOrderExceptions",
    "adminListOrderExceptions",
    "adminReviewOrderException",
    "adminOrderExceptionSummary"
  ],
  "./rpcs/driver-levels": [
    "driverGetMyLevel",
    "adminListDriverLevels",
    "adminSetDriverLevelOverride",
    "adminEvaluateDriverLevelsSweep"
  ]
};

export function moduleForFunction(name: string): string | null {
  for (const [modulePath, names] of Object.entries(LEGACY_MODULES)) {
    if (names.includes(name)) return modulePath;
  }
  return null;
}

/** require() path from functions/src/router (one directory deeper than index). */
export function routerRequirePath(name: string): string | null {
  const fromIndex = moduleForFunction(name);
  if (!fromIndex?.startsWith("./")) return null;
  return `../${fromIndex.slice(2)}`;
}

export function allLegacyNames(): string[] {
  return Object.values(LEGACY_MODULES).flat();
}
