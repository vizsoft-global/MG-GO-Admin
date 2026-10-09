import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export { adminDeliveriesStatusCounts, adminDeliveriesCountsByFilters } from "./rpcs/deliveries-counts";
export { adminBulkUpdateDeliveries } from "./rpcs/deliveries-status";
export { adminListAttendanceDaily, adminAttendanceKpis } from "./rpcs/attendance";
export { adminGetDriverDayRoute } from "./rpcs/day-route";
export { adminPayrollRuleSnapshot } from "./rpcs/payroll";
export {
  adminIncentiveDailyReport,
  listDriverEarningsDaily,
  recalculateDriverEarnings,
  recalculateEarningsForDate,
  recalculateEarningsForRange,
  getDriverEarningsDetail,
  previewDriverEarnings,
} from "./rpcs/earnings";
export {
  adminPurgeFilterColumns,
  adminPurgePreviewAll,
  adminPurgeFilteredValues,
  adminPurgeFilteredPreview,
  adminPurgeFilteredPage,
} from "./rpcs/purge";
export {
  adminPurgeRunAll,
  adminPurgeFilteredRun,
  adminPreviewPurge,
  adminPurgeDeliveries,
  adminPurgeDrivers,
  adminPurgeIntakes,
  adminPurgeRestaurants,
  adminPurgeZones,
  adminPurgeDeliveryRules,
  adminPurgeIncentiveRules,
  adminPurgeAssetCatalog,
} from "./rpcs/purge-all";
export {
  adminPerformanceOpsBounds,
  adminListPerformanceTargetDpd,
  adminUpsertPerformanceTargetDpd,
  adminDpdLiveSnapshot,
  adminDpdNoticeCandidates,
  adminDpdEfficiencySnapshot,
  adminPerformanceOpsSnapshot,
  claimDpdShiftNotice,
} from "./rpcs/ops";
export {
  adminLiveFleetSnapshot,
  adminListFleetEvents,
} from "./rpcs/fleet";
export {
  adminListPerformanceComponents,
  adminUpdatePerformanceComponents,
  adminListPerformanceRatingTeams,
  adminDeleteDriverPerformanceRating,
  adminRunPerformanceDailyRollup,
  adminDriverPerformanceDaily,
} from "./rpcs/performance-extra";
export {
  adminListVisits,
  adminUpdateVisitStatus,
  adminRescheduleVisit,
  adminSetVisitNoteToRider,
  adminSyncBranchSlotsToWorkingDays,
} from "./rpcs/visits";
export {
  adminUpsertZone,
  adminDeleteZone,
  adminUpsertPartner,
  adminDeletePartner,
  adminUpsertRestaurant,
  adminDeleteRestaurant,
  adminUpsertVehicleType,
  adminUpsertVehicleUseType,
  adminUpsertAssetCatalog,
  adminDeleteAssetCatalog,
  adminAdjustAssetStock,
  adminReturnAssetAssignment,
  adminUpsertCustomFieldDefinition,
  adminReorderCustomFieldDefinitions,
  adminDeleteCustomFieldDefinition,
  adminUpsertLoanTenureOption,
  adminDeleteLoanTenureOption,
  adminUpsertComplaintCategory,
  adminDeleteComplaintCategory,
} from "./rpcs/catalogs";
export {
  adminInsertDeliveryRuleWithScope,
  adminUpsertSourceCompany,
  adminUpsertDeliveryRule,
  adminDeleteDeliveryRule,
  adminListDeliveryRules,
  adminBulkUpdateDeliveryRules,
  adminUpsertIncentiveRule,
  adminDeleteIncentiveRule,
  adminListIncentiveRules,
  adminExportIncentiveRules,
  adminUpsertExceptionAction,
} from "./rpcs/rules";
export {
  adminPayrollRuleConfig,
  adminOpenPayrollRuleMonth,
  adminSavePayrollClient,
  adminSavePayrollClientRules,
  adminResetPayrollClientRules,
  adminAddPayrollClient,
  adminDeletePayrollClient,
  adminListPayrollColumnConfig,
  adminSetPayrollColumnConfig,
} from "./rpcs/payroll-clients";
export {
  claimDriverImportChunk,
  cleanupDriverLocationEvents,
  cleanupDriverOperationEvents,
  cleanupDriverTelemetryEvents,
  cleanupStaleDriverLocations,
} from "./rpcs/retention";
export {
  adminListDriversPage,
  adminDriversFilterValues,
  setDriverAccountStatus,
  setDriverBlocked,
  setDriverFrozen,
  setDriverUnfrozen,
  adminDriverAppInstallVersions,
} from "./rpcs/drivers";
export {
  adminApproveDriver,
  allocateDriverCode,
  archiveDriverIntake,
  restoreDriverIntake,
  regenerateDriverAppPasscode,
  intakeHasOpsAssignment,
  adminSetDriverOffStructure,
  adminBulkSetDriverOffStructure,
} from "./rpcs/drivers-admin";
export {
  adminListDriverDevices,
  adminDriverDeviceOverview,
  adminDriversMultiDeviceRecent,
  adminForceSignOutDriver,
  adminSetDriverForceUpdate,
  driverRecordAppVersion,
} from "./rpcs/driver-devices";
export {
  driverListNotifications,
  driverMarkNotificationsRead,
  driverDismissNotifications,
  notifyDriverTransactional,
  adminExpireStalePickups,
  driverOpsAuditHealth,
} from "./rpcs/misc-admin";
export { adminListFuelFills, adminSetFuelTransferType } from "./rpcs/fuel";
export {
  enqueueNotificationAutomationEvent,
  recordNotificationClientEvent,
} from "./rpcs/notifications";
export {
  resolveImportDriverIds,
  estimateNotificationAudience,
  compileNotificationAudienceIds,
  compileNotificationAudience,
} from "./rpcs/notification-audience";
export {
  adminListRequests,
  adminGetRequest,
  adminCreateRequest,
  adminCountRequestsByType,
  adminRequestsTrend,
  adminRequestDepartmentReport,
} from "./rpcs/requests-core";
export {
  adminDecideRequest,
  adminForwardRequest,
  adminEscalateRequest,
  adminAddRequestComment,
  adminSetRequestDecisionMeta,
  adminUpsertStepTemplate,
  adminAutoCloseRequests,
  adminRunRequestSlaSweep,
  adminUploadIncomingDocument,
} from "./rpcs/requests-workflow";
export {
  esignEmployeeSnapshot,
  adminExpireEsignRequests,
  adminListEsignRequests,
  adminCreateEsignRequest,
  adminRemindEsignRequests,
  adminEsignReminderState,
  adminLinkEsignResend,
  adminUpsertEsignTemplate,
  adminUpsertEsignTemplateField,
} from "./rpcs/esign-requests";
export {
  adminListEsignSigners,
  adminEsignSignerOptions,
  adminAddEsignSigner,
  adminRemoveEsignSigner,
  adminReorderEsignSigners,
  adminListMyEsignSignatures,
  adminSubmitEsignSignature,
  adminDeclineEsignSignature,
} from "./rpcs/esign-signers";
export {
  adminCreateEsignBatch,
  adminEsignBatchKpis,
  adminUpdateEsignBatchRow,
  adminRemoveEsignBatchRow,
  esignWorkerDrainableBatches,
  adminSaveEsignDraft,
  adminListEsignDrafts,
  adminGetEsignDraft,
  adminDeleteEsignDraft,
} from "./rpcs/esign-batches";
export {
  adminAttendanceAnalyticsDaily,
  adminCorrectAttendance,
  adminGetShiftAdherence,
  adminListShiftAdherence,
  adminListAttendanceExceptions,
  adminRunAttendanceAutoCheckout,
  adminRunFreezeStartCheckout,
} from "./rpcs/attendance-ops";
export {
  adminApplyPayrollAdjustments,
  adminPayrollAdjustmentAudit,
  adminPayrollMonthSnapshot,
  adminPayrollZoneSettings,
  adminSavePayrollZoneSettings,
  adminSavePayrollZoneOverride,
  adminRecomputePayrollZoneMetrics,
} from "./rpcs/payroll-more";
export {
  getEarningsOverview,
  listEarningsGrouped,
  generatePayoutRun,
  approvePayoutRun,
  markPayoutRunPaid,
  voidPayoutRun,
  getPayoutRunDetail,
} from "./rpcs/payouts";
export {
  adminOrderComparisonSnapshot,
  adminOrderReconCompare,
  reconcileDeliveryVerification,
  deliveryMatchesRules,
  reportDeliveryOrders,
} from "./rpcs/recon-reports";
export {
  adminUpsertDriverPerformanceRating,
  adminSetDriverPerformanceRatingNote,
  adminListDriverPerformanceRatings,
  adminSetPerformanceTeamMember,
  adminUpsertPerformanceRatingCriterion,
  adminDeletePerformanceRatingCriterion,
} from "./rpcs/performance-ratings";
export { adminListDriverPerformance, adminPerformanceTrend } from "./rpcs/performance-list";

// One project, one region: Firestore, Functions and Storage all live in
// me-central2 so a function-to-database call never leaves the metro. The region
// is a property of the deployment, not of any single function.
setGlobalOptions({ region: "me-central2", maxInstances: 20 });

initializeApp();

export type StaffClaims = {
  staff: boolean;
  superAdmin: boolean;
  roleId: string | null;
};

/**
 * Derives the staff claims for a uid from its Firestore profile.
 *
 * Claims are always derived from the stored profile, never from the caller's
 * payload — a staff member re-syncing their own claims cannot grant themselves
 * `superAdmin`, because there is no field in the request that reaches the
 * computed value.
 */
async function resolveStaffClaims(uid: string): Promise<StaffClaims | null> {
  const db = getFirestore();
  const profileSnap = await db.collection("profiles").doc(uid).get();
  if (!profileSnap.exists) return null;

  const profile = profileSnap.data() ?? {};
  if (profile.role !== "staff") return null;

  const roleId = (profile.admin_role_id as string | null) ?? null;
  let isSuperAdmin = false;
  if (roleId) {
    const roleSnap = await db.collection("admin_roles").doc(roleId).get();
    isSuperAdmin = roleSnap.data()?.is_super_admin === true;
  }

  return { staff: true, superAdmin: isSuperAdmin, roleId };
}

/**
 * Staff custom claims, set only here.
 *
 * `uid` may be omitted (the caller syncs their own claims). Naming another uid
 * requires the caller to already be a super admin, so this doubles as the
 * role-change hook without opening a way to promote arbitrary accounts.
 */
export const syncStaffClaims = onCall(async (request: CallableRequest<{ uid?: string }>) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "not_authenticated");
  }

  const targetUid = request.data?.uid?.trim() || callerUid;

  if (targetUid !== callerUid) {
    const callerProfile = await getFirestore().collection("profiles").doc(callerUid).get();
    const callerRoleId = callerProfile.data()?.admin_role_id as string | undefined;
    const callerIsSuperAdmin = callerRoleId
      ? (await getFirestore().collection("admin_roles").doc(callerRoleId).get()).data()
          ?.is_super_admin === true
      : false;
    if (!callerIsSuperAdmin) {
      throw new HttpsError("permission-denied", "not_authorized");
    }
  }

  const claims = await resolveStaffClaims(targetUid);
  if (!claims) {
    throw new HttpsError("permission-denied", "not_staff");
  }

  await getAuth().setCustomUserClaims(targetUid, claims);
  return { uid: targetUid, claims };
});
