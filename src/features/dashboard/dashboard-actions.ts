"use server";

import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS, APP_SETTINGS_DOC_ID } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { fetchDashboardDeliveryRows } from "@/features/deliveries/deliveries-actions";
import { deliveryActivityAt } from "@/features/deliveries/delivery-sort-utils";
import { fetchDriversForAdmin } from "@/features/drivers/drivers-actions";
import { fetchLiveDriverLocations } from "@/features/locations/locations-actions";
import type { DeliveryListRow } from "@/features/deliveries/types";
import type { DriverListRow } from "@/features/drivers/types";
import { listDriverEarningsDaily } from "@/features/dpd/incentive-calculator";
import { listPendingStaffAccessRequests } from "@/features/settings/access-requests-actions";
import type {
  AccessRequestRow,
  AdminActionItem,
  AttendanceMonitorRow,
  DashboardKpis,
  DashboardPermissions,
  DashboardSnapshot,
  DeliveryFeedItem,
  DeliveryMonitorMetrics,
  EarningsWatchRow,
  PartnerHealthCard,
  PayrollReadinessSummary,
  PresenceMapRestaurant,
  PresenceMapZone,
  SystemStatusSummary,
  WorkforceQueueRow,
  WorkforceStatus,
} from "./types";

import {
  currentOperationalDayYmd,
  operationalDayBounds,
  operationalDayStartIso,
} from "@/lib/date/operational-day";

const SILENT_HOURS = 3;

function dashPlain(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if ("toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return value;
}

function dashStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function dashRows(
  db: Firestore,
  collection: string,
  ids: string[],
): Promise<Map<string, DocumentData>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, DocumentData>();
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map((id) => db.collection(collection).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) map.set(snap.id, snap.data() ?? {});
    }
  }
  return map;
}

/**
 * The narrow delivery shape the dashboard reads. It arrives from
 * `fetchDashboardDeliveryRows` (ten columns, no proof signing, no restaurant
 * resolution) rather than the full enriched list row, so the dashboard helpers
 * are typed structurally instead of demanding all of `DeliveryListRow`.
 */
type DeliveryActivityRow = Pick<
  DeliveryListRow,
  | "id"
  | "short_id"
  | "driver_id"
  | "driver_name"
  | "status"
  | "external_order_id"
  | "created_at"
  | "pickup_at"
  | "delivered_at"
  | "cancelled_at"
>;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return ms / (1000 * 60 * 60);
}

function buildPermissions(session: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>): DashboardPermissions {
  return {
    drivers: hasPermissionInSet(session.permissions, "drivers.view", session.isSuperAdmin),
    deliveries: hasPermissionInSet(session.permissions, "deliveries.view", session.isSuperAdmin),
    earnings: hasPermissionInSet(session.permissions, "earnings.view", session.isSuperAdmin),
    attendance: hasPermissionInSet(session.permissions, "attendance.view", session.isSuperAdmin),
    verifications: hasPermissionInSet(
      session.permissions,
      "verifications.view",
      session.isSuperAdmin,
    ),
    audit: hasPermissionInSet(session.permissions, "audit.view", session.isSuperAdmin),
    superAdmin: session.isSuperAdmin,
  };
}

async function requireDashboardView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "dashboard.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

function emptyKpis(): DashboardKpis {
  return {
    pendingAccessRequests: 0,
    verificationBacklog: 0,
    deliveryReviewPending: 0,
    payrollBlockers: 0,
    driverExceptions: 0,
    absentToday: 0,
  };
}

function accessRequestAgeBucket(createdAt: string): AccessRequestRow["ageBucket"] {
  const hours = hoursSince(createdAt) ?? 0;
  if (hours < 1) return "fresh";
  if (hours < 24) return "waiting";
  return "stale";
}

function buildAccessRequests(
  rows: Array<{ id: string; email: string | null; full_name: string | null; created_at: string }>,
): AccessRequestRow[] {
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    createdAt: row.created_at,
    ageBucket: accessRequestAgeBucket(row.created_at),
  }));
}

function buildAdminActionQueue(input: {
  accessRequests: AccessRequestRow[];
  notReportedYet: number;
  deliveryMetrics: DeliveryMonitorMetrics;
  earningsRows: EarningsWatchRow[];
  workforceQueue: WorkforceQueueRow[];
  locale: string;
}): AdminActionItem[] {
  const now = new Date().toISOString();
  const items: AdminActionItem[] = [];

  for (const req of input.accessRequests.slice(0, 3)) {
    items.push({
      id: `access-${req.id}`,
      severity: req.ageBucket === "stale" ? "danger" : req.ageBucket === "waiting" ? "warning" : "info",
      category: "access",
      titleKey: "accessPending",
      detail: req.email ?? req.fullName ?? "Unknown user",
      href: `/${input.locale}/settings/access-requests`,
      at: req.createdAt,
    });
  }

  if (input.notReportedYet > 0) {
    items.push({
      id: "verification-not-reported",
      severity: "warning",
      category: "verification",
      titleKey: "verificationNotReported",
      detail: `${input.notReportedYet} drivers`,
      href: `/${input.locale}/dpd-verification`,
      at: now,
    });
  }

  if (input.deliveryMetrics.underReview > 0) {
    items.push({
      id: "delivery-under-review",
      severity: "warning",
      category: "delivery",
      titleKey: "deliveryUnderReview",
      detail: `${input.deliveryMetrics.underReview} submissions`,
      href: `/${input.locale}/deliveries`,
      at: now,
    });
  }

  const payrollAnomalies = input.earningsRows.filter((r) => r.anomalies.length > 0);
  for (const row of payrollAnomalies.slice(0, 3)) {
    items.push({
      id: `payroll-${row.driverId}`,
      severity: "warning",
      category: "payroll",
      titleKey: "payrollAnomaly",
      detail: `${row.driverName} (#${row.driverCode})`,
      href: `/${input.locale}/earnings`,
      at: now,
    });
  }

  for (const row of input.workforceQueue) {
    if (row.status === "silent") {
      items.push({
        id: `silent-${row.driverId}`,
        severity: "warning",
        category: "driver",
        titleKey: "driverSilent",
        detail: `${row.driverName} (#${row.driverCode})`,
        href: `/${input.locale}/drivers/${row.driverId}`,
        at: row.lastActivityAt ?? now,
      });
    } else if (row.status === "missing") {
      items.push({
        id: `missing-${row.driverId}`,
        severity: "warning",
        category: "driver",
        titleKey: "driverMissingAttendance",
        detail: `${row.driverName} (#${row.driverCode})`,
        href: `/${input.locale}/attendance`,
        at: now,
      });
    } else if (row.status === "suspended") {
      items.push({
        id: `suspended-${row.driverId}`,
        severity: "danger",
        category: "driver",
        titleKey: "driverSuspended",
        detail: `${row.driverName} (#${row.driverCode})`,
        href: `/${input.locale}/drivers/${row.driverId}`,
        at: now,
      });
    }
    if (items.length >= 12) break;
  }

  return items.slice(0, 12);
}

function buildPayrollReadiness(rows: EarningsWatchRow[]): PayrollReadinessSummary {
  const blocked = rows.filter((r) => r.anomalies.length > 0);
  const ready = rows.filter((r) => r.anomalies.length === 0 && r.deliveries > 0);
  return {
    readyCount: ready.length,
    blockedCount: blocked.length,
    anomalyCount: blocked.length,
    totalEstimatedKwd: rows.reduce((sum, r) => sum + r.estimatedKwd, 0),
    rows,
  };
}

function deriveWorkforceStatus(
  driver: DriverListRow,
  deliveryCount: number,
  lastDeliveryAt: string | null,
  hasUnderReview: boolean,
  checkedIn: boolean,
): WorkforceStatus {
  if (driver.account_status === "suspended" || driver.archived_at) return "suspended";
  if (hasUnderReview) return "awaiting_verification";
  if (driver.is_on_duty && deliveryCount > 0) return "working";
  if (driver.is_on_duty) {
    const silentHours = hoursSince(lastDeliveryAt);
    if (silentHours != null && silentHours >= SILENT_HOURS) return "silent";
    return "online";
  }
  if (!checkedIn && driver.account_status === "active") return "missing";
  return "online";
}

function buildWorkforceQueue(
  drivers: DriverListRow[],
  deliveries: DeliveryActivityRow[],
  checkedInDriverIds: Set<string>,
  driverRestaurants: Map<string, string>,
  intakeToProfile: Map<string, string>,
  liveByDriver: Map<
    string,
    { lastSeenAt: string; zoneStatus: string | null; trackingStatus: string }
  >,
): WorkforceQueueRow[] {
  const deliveriesByDriver = new Map<string, DeliveryActivityRow[]>();
  for (const d of deliveries) {
    const list = deliveriesByDriver.get(d.driver_id) ?? [];
    list.push(d);
    deliveriesByDriver.set(d.driver_id, list);
  }

  return drivers
    .filter((d) => !d.archived_at && d.linked)
    .map((driver) => {
      const profileId = intakeToProfile.get(driver.id) ?? driver.id;
      const driverDeliveries = deliveriesByDriver.get(profileId) ?? [];
      const sorted = [...driverDeliveries].sort((a, b) =>
        deliveryActivityAt(b).localeCompare(deliveryActivityAt(a)),
      );
      const lastDelivery = sorted[0] ? deliveryActivityAt(sorted[0]) : null;
      const hasUnderReview = driverDeliveries.some((d) => d.status === "under_review");
      const status = deriveWorkforceStatus(
        driver,
        driverDeliveries.length,
        lastDelivery,
        hasUnderReview,
        checkedInDriverIds.has(profileId),
      );

      const alerts: string[] = [];
      if (status === "silent") alerts.push("silent");
      if (status === "missing") alerts.push("missing_attendance");
      if (hasUnderReview) alerts.push("verification_pending");
      if (driver.today_deliveries === 0 && driver.is_on_duty) alerts.push("no_deliveries");

      const live = liveByDriver.get(profileId);

      return {
        driverId: driver.id,
        linkedProfileId: profileId,
        driverName: driver.full_name,
        driverCode: driver.driver_code,
        partnerName: driver.partner_name,
        restaurantName: driverRestaurants.get(profileId) ?? "—",
        zoneName: driver.zone_name,
        status,
        shiftLabel: driver.is_on_duty ? "on_duty" : "off_duty",
        deliveriesToday: driver.today_deliveries,
        lastActivityAt: lastDelivery,
        lastGpsAt: live?.lastSeenAt ?? null,
        zoneStatus: live?.zoneStatus ?? null,
        trackingStatus: live?.trackingStatus ?? null,
        alerts,
      };
    })
    .sort((a, b) => b.deliveriesToday - a.deliveriesToday)
    .slice(0, 50);
}

function buildDeliveryMetrics(
  todayDeliveries: DeliveryActivityRow[],
  weekDeliveries: DeliveryActivityRow[],
): { metrics: DeliveryMonitorMetrics; feed: DeliveryFeedItem[] } {
  const today = todayDeliveries.length;
  const avgLast7Days = weekDeliveries.length / 7;
  const spikeDetected = today > avgLast7Days * 1.5 && today >= 5;

  const metrics: DeliveryMonitorMetrics = {
    submittedToday: today,
    pending: todayDeliveries.filter((d) => d.status === "pending").length,
    verified: todayDeliveries.filter((d) => d.status === "verified").length,
    rejected: todayDeliveries.filter((d) => d.status === "rejected").length,
    underReview: todayDeliveries.filter((d) => d.status === "under_review").length,
    spikeDetected,
    avgLast7Days: Math.round(avgLast7Days * 10) / 10,
  };

  const sorted = [...todayDeliveries].sort((a, b) =>
    deliveryActivityAt(b).localeCompare(deliveryActivityAt(a)),
  );
  const feed: DeliveryFeedItem[] = sorted.slice(0, 20).map((d) => {
    let messageKey: DeliveryFeedItem["messageKey"] = "submitted";
    let severity: DeliveryFeedItem["severity"] = "info";
    if (d.status === "verified") {
      messageKey = "verified";
      severity = "success";
    } else if (d.status === "rejected") {
      messageKey = "rejected";
      severity = "danger";
    } else if (d.status === "under_review") {
      messageKey = "underReview";
      severity = "warning";
    } else if (d.status === "pending") {
      messageKey = "verificationPending";
      severity = "warning";
    }
    return {
      id: d.id,
      at: deliveryActivityAt(d),
      driverName: d.driver_name,
      messageKey,
      detail: d.external_order_id ?? d.short_id,
      severity,
    };
  });

  return { metrics, feed };
}

function buildEarningsWatch(
  todayRows: Array<{
    driver_id: string;
    driver_name: string;
    driver_code: string;
    deliveries: number;
    incentive_kwd: number;
    net_kwd: number;
  }>,
  historyByDriver: Map<string, number[]>,
): EarningsWatchRow[] {
  return todayRows.slice(0, 30).map((row) => {
    const history = historyByDriver.get(row.driver_id) ?? [];
    const avg =
      history.length > 0 ? history.reduce((a, b) => a + b, 0) / history.length : 0;
    const anomalies: EarningsWatchRow["anomalies"] = [];
    if (row.net_kwd > 0 && avg > 0 && row.net_kwd > avg * 2) {
      anomalies.push("high_payout");
    }
    if (row.deliveries > 0 && row.net_kwd === 0) {
      anomalies.push("zero_earnings");
    }
    if (row.deliveries === 0 && row.net_kwd > 0) {
      anomalies.push("delivery_mismatch");
    }
    return {
      driverId: row.driver_id,
      driverName: row.driver_name,
      driverCode: row.driver_code,
      deliveries: row.deliveries,
      ruleLabel: row.incentive_kwd > 0 ? "incentive_active" : "base_only",
      incentiveKwd: row.incentive_kwd,
      estimatedKwd: row.net_kwd,
      anomalies,
    };
  });
}

function buildAttendanceMonitor(
  drivers: DriverListRow[],
  attendanceByDriver: Map<string, { status: string; check_in_at: string | null; check_out_at: string | null }>,
  intakeToProfile: Map<string, string>,
): AttendanceMonitorRow[] {
  const byPartner = new Map<string, AttendanceMonitorRow>();
  for (const driver of drivers.filter((d) => d.linked && !d.archived_at)) {
    const partner = driver.partner_name || "—";
    const row = byPartner.get(partner) ?? {
      partnerName: partner,
      scheduled: 0,
      checkedIn: 0,
      late: 0,
      absent: 0,
      overtime: 0,
    };
    row.scheduled += 1;
    const profileId = intakeToProfile.get(driver.id) ?? driver.id;
    const att = attendanceByDriver.get(profileId);
    if (att?.check_in_at || driver.is_on_duty) {
      row.checkedIn += 1;
      if (att?.status === "late") row.late += 1;
      if (att?.check_in_at && att.check_out_at) {
        const hours =
          (new Date(att.check_out_at).getTime() - new Date(att.check_in_at).getTime()) /
          (1000 * 60 * 60);
        if (hours > 10) row.overtime += 1;
      }
    } else if (driver.account_status === "active") {
      row.absent += 1;
    }
    byPartner.set(partner, row);
  }
  return Array.from(byPartner.values()).sort((a, b) => b.scheduled - a.scheduled);
}

function buildPartnerHealth(
  drivers: DriverListRow[],
  checkedInIds: Set<string>,
  verificationPendingByPartner: Map<string, number>,
  restaurantCounts: Map<string, { name: string; partnerId: string; count: number; inactive: number }>,
  intakeToProfile: Map<string, string>,
): PartnerHealthCard[] {
  const byPartner = new Map<string, PartnerHealthCard>();

  for (const driver of drivers.filter((d) => d.linked && !d.archived_at)) {
    const pid = driver.partner_id ?? "unknown";
    const card = byPartner.get(pid) ?? {
      partnerId: pid,
      partnerName: driver.partner_name,
      assignedRiders: 0,
      activeToday: 0,
      missingAttendance: 0,
      pendingVerification: verificationPendingByPartner.get(pid) ?? 0,
      restaurants: [],
    };
    card.assignedRiders += 1;
    if (driver.is_on_duty || driver.today_deliveries > 0) card.activeToday += 1;
    const profileId = intakeToProfile.get(driver.id) ?? driver.id;
    if (!checkedInIds.has(profileId) && driver.account_status === "active") {
      card.missingAttendance += 1;
    }
    byPartner.set(pid, card);
  }

  const restaurantsByPartner = new Map<string, PartnerHealthCard["restaurants"]>();
  for (const [, info] of restaurantCounts) {
    const list = restaurantsByPartner.get(info.partnerId) ?? [];
    list.push({
      restaurantId: "",
      restaurantName: info.name,
      riderCount: info.count,
      understaffed: info.count < 3,
      inactiveCount: info.inactive,
    });
    restaurantsByPartner.set(info.partnerId, list);
  }

  return Array.from(byPartner.values())
    .map((card) => ({
      ...card,
      restaurants: (restaurantsByPartner.get(card.partnerId) ?? []).slice(0, 5),
    }))
    .sort((a, b) => b.assignedRiders - a.assignedRiders)
    .slice(0, 8);
}

export async function fetchDashboardSnapshot(locale = "en"): Promise<DashboardSnapshot> {
  const session = await requireDashboardView();
  void logAdminRead("dashboard", "fetchDashboardSnapshot");
  const perms = buildPermissions(session);
  const today = currentOperationalDayYmd();
  // The dashboard's "today" is the operational day, not the calendar day: the
  // client counts Sep 30 as 06:00 Sep 30 -> 06:00 Oct 1, and a calendar window
  // put Oct 1 00:00-06:00 orders in the wrong day's tile -- which is exactly the
  // discrepancy the report had. Both the day tile and the 7-day tile use the
  // same boundary the report does.
  const { from: start, to: end } = operationalDayBounds(today);
  const weekStart = addDays(today, -6);
  const weekStartIso = operationalDayStartIso(weekStart);

  let drivers: DriverListRow[] = [];
  let deliveries: DeliveryActivityRow[] = [];

  if (perms.drivers) {
    try {
      drivers = await fetchDriversForAdmin();
    } catch {
      drivers = [];
    }
  }

  // Bound the fetch to the window the two filters below can actually keep.
  // The coalesce the filters use can only reach the week start if one of its
  // four timestamps does, so the query's OR is a strict superset and the
  // filters (unchanged) still decide the result. Replaces an all-time fetch
  // that pulled 184,353 rows for the same two in-memory filters.
  if (perms.deliveries) {
    try {
      deliveries = await fetchDashboardDeliveryRows(
        new Date(weekStartIso).toISOString(),
      );
    } catch {
      deliveries = [];
    }
  }

  const todayDeliveries = deliveries.filter((d) => {
    const at = deliveryActivityAt(d);
    return at >= start && at <= end;
  });
  const weekDeliveries = deliveries.filter(
    (d) => deliveryActivityAt(d) >= weekStartIso,
  );

  const db = await staffDb();
  if (!db) throw new Error("not_configured");

  const intakeToProfile = new Map<string, string>();
  if (perms.drivers) {
    const intakeLinks = await db
      .collection(COLLECTIONS.driverIntakes)
      .where("archived_at", "==", null)
      .get();
    for (const doc of intakeLinks.docs) {
      const linked = dashStr(doc.data().linked_profile_id);
      if (linked) intakeToProfile.set(doc.id, linked);
    }
  }

  const checkedInDriverIds = new Set<string>();
  const attendanceByDriver = new Map<
    string,
    { status: string; check_in_at: string | null; check_out_at: string | null }
  >();

  if (perms.attendance) {
    const attendanceRows = await db
      .collection(COLLECTIONS.attendanceLogs)
      .where("log_date", "==", today)
      .get();
    for (const doc of attendanceRows.docs) {
      const data = doc.data();
      const driverId = dashStr(data.driver_id);
      const checkIn = dashPlain(data.check_in_at);
      const checkOut = dashPlain(data.check_out_at);
      const row = {
        status: dashStr(data.status),
        check_in_at: typeof checkIn === "string" ? checkIn : null,
        check_out_at: typeof checkOut === "string" ? checkOut : null,
      };
      if (row.check_in_at) checkedInDriverIds.add(driverId);
      if (driverId) attendanceByDriver.set(driverId, row);
    }
  }

  let onlineNow = 0;
  if (perms.drivers) {
    const countSnap = await db
      .collection(COLLECTIONS.driverSessions)
      .where("is_online", "==", true)
      .count()
      .get();
    onlineNow = countSnap.data().count;
  }
  void onlineNow;

  let restaurantAssigned = 0;
  const driverRestaurants = new Map<string, string>();
  const restaurantCounts = new Map<
    string,
    { name: string; partnerId: string; count: number; inactive: number }
  >();

  if (perms.drivers) {
    const linkSnap = await db.collection(COLLECTIONS.driverRestaurants).get();
    const restaurantIds = linkSnap.docs
      .map((doc) => dashStr(doc.data().restaurant_id))
      .filter(Boolean);
    const restaurantsById = await dashRows(db, COLLECTIONS.restaurants, restaurantIds);
    const assignedDrivers = new Set<string>();
    for (const doc of linkSnap.docs) {
      const driverId = dashStr(doc.data().driver_id);
      const rest = restaurantsById.get(dashStr(doc.data().restaurant_id));
      assignedDrivers.add(driverId);
      const restName = rest ? dashStr(rest.name) : "";
      const restPartner = rest ? dashStr(rest.partner_id) : "";
      if (restName && driverId && !driverRestaurants.has(driverId)) {
        driverRestaurants.set(driverId, restName);
      }
      if (restName && restPartner) {
        const key = `${restPartner}:${restName}`;
        const existing = restaurantCounts.get(key) ?? {
          name: restName,
          partnerId: restPartner,
          count: 0,
          inactive: 0,
        };
        existing.count += 1;
        if (rest?.is_active === false) existing.inactive += 1;
        restaurantCounts.set(key, existing);
      }
    }
    restaurantAssigned = assignedDrivers.size;
  }
  void restaurantAssigned;

  let notReportedYet = 0;
  if (perms.verifications && perms.drivers) {
    const activeProfileIds = drivers
      .filter((d) => d.account_status === "active" && d.linked && !d.archived_at)
      .map((d) => intakeToProfile.get(d.id))
      .filter((id): id is string => Boolean(id));
    if (activeProfileIds.length > 0) {
      const verificationSnap = await db
        .collection(COLLECTIONS.deliveryVerifications)
        .where("service_date", "==", today)
        .get();
      const reported = new Set(verificationSnap.docs.map((doc) => dashStr(doc.data().driver_id)));
      notReportedYet = activeProfileIds.filter((id) => !reported.has(id)).length;
    }
  }

  let earningsRows: EarningsWatchRow[] = [];
  const historyByDriver = new Map<string, number[]>();

  if (perms.earnings) {
    const earningsResult = await listDriverEarningsDaily(weekStart, today);
    if (!("error" in earningsResult)) {
      const todayEarnings = earningsResult.rows.filter((r) => r.earn_date === today);
      for (const row of earningsResult.rows) {
        if (row.earn_date === today) continue;
        const list = historyByDriver.get(row.driver_id) ?? [];
        list.push(row.net_kwd ?? 0);
        historyByDriver.set(row.driver_id, list);
      }
      earningsRows = buildEarningsWatch(
        todayEarnings.map((r) => ({
          driver_id: r.driver_id,
          driver_name: r.driver_name,
          driver_code: r.driver_code,
          deliveries: r.deliveries,
          incentive_kwd: r.incentive_kwd,
          net_kwd: r.net_kwd,
        })),
        historyByDriver,
      );
    }
  }

  const linkedDrivers = drivers.filter((d) => d.linked && !d.archived_at);
  const suspendedArchived = drivers.filter(
    (d) => d.account_status === "suspended" || Boolean(d.archived_at),
  ).length;

  let accessRequests: AccessRequestRow[] = [];
  if (perms.superAdmin) {
    const pendingProfiles = await listPendingStaffAccessRequests(10);
    accessRequests = buildAccessRequests(pendingProfiles);
  }

  let systemStatus: SystemStatusSummary = { maintenanceMode: false };
  if (perms.superAdmin) {
    const appSettings = await db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get();
    systemStatus = { maintenanceMode: appSettings.data()?.maintenance_mode === true };
  }

  let trackedNow = 0;
  const liveByDriver = new Map<
    string,
    { lastSeenAt: string; zoneStatus: string | null; trackingStatus: string }
  >();

  if (perms.drivers) {
    try {
      const liveLocations = await fetchLiveDriverLocations();
      trackedNow = liveLocations.length;
      for (const loc of liveLocations) {
        liveByDriver.set(loc.driverId, {
          lastSeenAt: loc.lastSeenAt,
          zoneStatus: loc.zoneStatus,
          trackingStatus: loc.trackingStatus,
        });
      }
    } catch {
      trackedNow = 0;
    }
  }

  const { metrics: deliveryMetrics, feed: deliveryFeed } = buildDeliveryMetrics(
    todayDeliveries,
    weekDeliveries,
  );

  const workforceQueue = perms.drivers
    ? buildWorkforceQueue(
        drivers,
        todayDeliveries,
        checkedInDriverIds,
        driverRestaurants,
        intakeToProfile,
        liveByDriver,
      )
    : [];

  const attendanceMonitor = perms.attendance
    ? buildAttendanceMonitor(drivers, attendanceByDriver, intakeToProfile)
    : [];

  const driverExceptions = workforceQueue.filter(
    (r) => r.status === "silent" || r.status === "missing" || r.status === "suspended",
  ).length;

  const absentToday = attendanceMonitor.reduce((sum, row) => sum + row.absent, 0);

  const payrollBlockers = earningsRows.filter((r) => r.anomalies.length > 0).length;

  const kpis: DashboardKpis = {
    pendingAccessRequests: accessRequests.length,
    verificationBacklog: notReportedYet + deliveryMetrics.underReview,
    deliveryReviewPending: deliveryMetrics.pending + deliveryMetrics.underReview,
    payrollBlockers,
    driverExceptions,
    absentToday,
  };

  const payrollReadiness = buildPayrollReadiness(earningsRows);

  const adminActionQueue = buildAdminActionQueue({
    accessRequests,
    notReportedYet,
    deliveryMetrics,
    earningsRows,
    workforceQueue,
    locale,
  });

  const verificationPendingByPartner = new Map<string, number>();
  if (perms.verifications) {
    const pendingSnap = await db
      .collection(COLLECTIONS.deliveryVerifications)
      .where("service_date", "==", today)
      .get();
    const pendingRows = pendingSnap.docs.filter((doc) => {
      const status = dashStr(doc.data().status);
      return status === "pending" || status === "deficit" || status === "conflict";
    });
    const driverIds = pendingRows.map((doc) => dashStr(doc.data().driver_id)).filter(Boolean);
    const driversById = await dashRows(db, COLLECTIONS.drivers, driverIds);
    for (const doc of pendingRows) {
      const driver = driversById.get(dashStr(doc.data().driver_id));
      const pid = driver ? dashStr(driver.partner_id) : "";
      if (pid) {
        verificationPendingByPartner.set(pid, (verificationPendingByPartner.get(pid) ?? 0) + 1);
      }
    }
  }

  const partnerHealth = perms.drivers
    ? buildPartnerHealth(
        drivers,
        checkedInDriverIds,
        verificationPendingByPartner,
        restaurantCounts,
        intakeToProfile,
      )
    : [];

  const zoneSnap = await db.collection(COLLECTIONS.zones).limit(20).get();
  const presenceZones: PresenceMapZone[] = zoneSnap.docs.map((doc) => ({
    id: doc.id,
    name: dashStr(doc.data().name),
    color: dashStr(doc.data().color) || "#6366f1",
  }));

  const restaurantSnap = await db
    .collection(COLLECTIONS.restaurants)
    .where("status", "==", "published")
    .limit(30)
    .get();
  const presenceRestaurants: PresenceMapRestaurant[] = restaurantSnap.docs.map((doc) => {
    const data = doc.data();
    const lat = data.latitude == null ? null : Number(data.latitude);
    const lng = data.longitude == null ? null : Number(data.longitude);
    return {
      id: doc.id,
      name: dashStr(data.name),
      lat: lat != null && Number.isFinite(lat) ? lat : null,
      lng: lng != null && Number.isFinite(lng) ? lng : null,
    };
  });

  return {
    fetchedAt: new Date().toISOString(),
    today,
    permissions: perms,
    kpis,
    accessRequests,
    adminActionQueue,
    payrollReadiness,
    systemStatus,
    workforceQueue,
    deliveryMetrics,
    deliveryFeed,
    earningsWatch: earningsRows,
    attendanceMonitor,
    partnerHealth,
    presenceZones,
    presenceRestaurants,
  };
}
