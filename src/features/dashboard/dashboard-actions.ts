"use server";

import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchDeliveriesForAdmin } from "@/features/deliveries/deliveries-actions";
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

const KUWAIT_TZ = "Asia/Kuwait";
const SILENT_HOURS = 3;

function kuwaitToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KUWAIT_TZ }).format(new Date());
}

function kuwaitDayBounds(date?: string): { start: string; end: string } {
  const today = date ?? kuwaitToday();
  return {
    start: `${today}T00:00:00+03:00`,
    end: `${today}T23:59:59.999+03:00`,
  };
}

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
  deliveries: DeliveryListRow[],
  checkedInDriverIds: Set<string>,
  driverRestaurants: Map<string, string>,
  intakeToProfile: Map<string, string>,
  liveByDriver: Map<
    string,
    { lastSeenAt: string; zoneStatus: string | null; trackingStatus: string }
  >,
): WorkforceQueueRow[] {
  const deliveriesByDriver = new Map<string, DeliveryListRow[]>();
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
  todayDeliveries: DeliveryListRow[],
  weekDeliveries: DeliveryListRow[],
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
  const today = kuwaitToday();
  const { start, end } = kuwaitDayBounds(today);
  const weekStart = addDays(today, -6);

  let drivers: DriverListRow[] = [];
  let deliveries: DeliveryListRow[] = [];

  if (perms.drivers) {
    try {
      drivers = await fetchDriversForAdmin();
    } catch {
      drivers = [];
    }
  }

  if (perms.deliveries) {
    try {
      deliveries = await fetchDeliveriesForAdmin();
    } catch {
      deliveries = [];
    }
  }

  const todayDeliveries = deliveries.filter((d) => {
    const at = deliveryActivityAt(d);
    return at >= start && at <= end;
  });
  const weekDeliveries = deliveries.filter(
    (d) => deliveryActivityAt(d) >= `${weekStart}T00:00:00+03:00`,
  );

  const supabase = await createClient();
  const admin = createAdminClient();

  const intakeToProfile = new Map<string, string>();
  if (perms.drivers) {
    const { data: intakeLinks } = await supabase
      .from("driver_intakes")
      .select("id, linked_profile_id")
      .is("archived_at", null);
    for (const row of intakeLinks ?? []) {
      if (row.linked_profile_id) {
        intakeToProfile.set(row.id, row.linked_profile_id);
      }
    }
  }

  const checkedInDriverIds = new Set<string>();
  const attendanceByDriver = new Map<
    string,
    { status: string; check_in_at: string | null; check_out_at: string | null }
  >();

  if (perms.attendance) {
    const { data: attendanceRows } = await supabase
      .from("attendance_logs")
      .select("driver_id, status, check_in_at, check_out_at")
      .eq("log_date", today);
    for (const row of attendanceRows ?? []) {
      if (row.check_in_at) checkedInDriverIds.add(row.driver_id);
      attendanceByDriver.set(row.driver_id, row);
    }
  }

  let onlineNow = 0;
  if (perms.drivers) {
    const { count } = await admin
      .from("driver_sessions")
      .select("driver_id", { count: "exact", head: true })
      .eq("is_online", true);
    onlineNow = count ?? 0;
  }

  let restaurantAssigned = 0;
  const driverRestaurants = new Map<string, string>();
  const restaurantCounts = new Map<
    string,
    { name: string; partnerId: string; count: number; inactive: number }
  >();

  if (perms.drivers) {
    const { data: drLinks } = await supabase
      .from("driver_restaurants")
      .select("driver_id, restaurants(name, partner_id, is_active)");
    const assignedDrivers = new Set<string>();
    for (const link of drLinks ?? []) {
      assignedDrivers.add(link.driver_id);
      const rest = Array.isArray(link.restaurants) ? link.restaurants[0] : link.restaurants;
      if (rest?.name && !driverRestaurants.has(link.driver_id)) {
        driverRestaurants.set(link.driver_id, rest.name);
      }
      if (rest?.name && rest.partner_id) {
        const key = `${rest.partner_id}:${rest.name}`;
        const existing = restaurantCounts.get(key) ?? {
          name: rest.name,
          partnerId: rest.partner_id,
          count: 0,
          inactive: 0,
        };
        existing.count += 1;
        if (rest.is_active === false) existing.inactive += 1;
        restaurantCounts.set(key, existing);
      }
    }
    restaurantAssigned = assignedDrivers.size;
  }

  let notReportedYet = 0;
  if (perms.verifications && perms.drivers) {
    const activeProfileIds = drivers
      .filter((d) => d.account_status === "active" && d.linked && !d.archived_at)
      .map((d) => intakeToProfile.get(d.id))
      .filter((id): id is string => Boolean(id));
    if (activeProfileIds.length > 0) {
      const { data: verifications } = await supabase
        .from("delivery_verifications")
        .select("driver_id")
        .eq("service_date", today);
      const reported = new Set((verifications ?? []).map((v) => v.driver_id));
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
    const { data: appSettings } = await supabase
      .from("app_settings")
      .select("maintenance_mode")
      .eq("id", 1)
      .maybeSingle();
    systemStatus = { maintenanceMode: appSettings?.maintenance_mode === true };
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
    const { data: pendingVerifications } = await supabase
      .from("delivery_verifications")
      .select("status, drivers(partner_id)")
      .eq("service_date", today)
      .in("status", ["pending", "deficit", "conflict"]);
    for (const v of pendingVerifications ?? []) {
      const d = Array.isArray(v.drivers) ? v.drivers[0] : v.drivers;
      const pid = (d as { partner_id?: string } | null)?.partner_id;
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

  const { data: zones } = await supabase.from("zones").select("id, name, color").limit(20);
  const presenceZones: PresenceMapZone[] = (zones ?? []).map((z) => ({
    id: z.id,
    name: z.name,
    color: z.color ?? "#6366f1",
  }));

  const { data: restaurants } = await supabase
    .from("restaurants")
    .select("id, name, latitude, longitude")
    .eq("status", "published")
    .limit(30);
  const presenceRestaurants: PresenceMapRestaurant[] = (restaurants ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    lat: r.latitude,
    lng: r.longitude,
  }));

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
