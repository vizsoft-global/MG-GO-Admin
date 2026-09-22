import { fetchDriverAttendanceRange } from "@/features/attendance/attendance-reporting-actions";
import { fetchAssetDetail } from "@/features/assets/assets-actions";
import { countDeliveriesByFilters, fetchRecentDeliveriesForDriver } from "@/features/deliveries/deliveries-actions";
import { listGroupsForDriver, getDriverGroup } from "@/features/driver-groups/driver-groups-actions";
import { fetchDriverDetail } from "@/features/drivers/drivers-actions";
import { fetchIncentiveDailyReport } from "@/features/earnings/earnings-actions";
import { fetchDriverOperationTimeline } from "@/features/live-tracking/operations-read-actions";
import { fetchFleetOpsCounts } from "@/features/driver-tracking/tracking-read-actions";
import { getNotificationCampaign } from "@/features/notifications/notifications-actions";
import { fetchPartnersForAdmin } from "@/features/partners/partners-actions";
import { fetchPayrollMonthSnapshot } from "@/features/payroll/payroll-actions";
import {
  fetchDriverPerformanceDetail,
  fetchDriverPerformanceRank,
  fetchPerformanceOpsSnapshot,
} from "@/features/performance/performance-actions";
import { EMPTY_OPS_SLICERS } from "@/features/performance/performance-ops-types";
import { fetchAdminRequestDetail, fetchAdminRequestsList } from "@/features/requests/requests-actions";
import type { RequestDatePreset } from "@/features/requests/types";
import { fetchRestaurantAssignedDrivers, fetchRestaurantDetail } from "@/features/restaurants/restaurants-actions";
import { listZonesForAssistant } from "@/features/zones/zones-read-actions";
import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/auth/get-session";
import type { Permission } from "@/lib/auth/permissions";
import { kuwaitDayCreatedAtBounds, monthKeyFromYmd, resolveAssistantDateRange } from "./assistant-dates";
import { assistantModuleAllowed, requireAssistantModule } from "./assistant-gates";
import {
  ASSISTANT_LIST_CAP,
  ENTITY_MODULE_PERMISSION,
  FLEET_ENTITY_ID,
  type AssistantEntityType,
} from "./assistant-entity";
import {
  sectionDenied,
  sectionUnavailable,
  stripActivityEvent,
  stripAttendanceDay,
  stripDeliveryHead,
  stripDriverIdentity,
  stripNotificationRow,
  stripPerformanceRow,
  stripRequestRow,
  stripVehicleRow,
} from "./assistant-strip";

type DateInput = { preset?: string; from?: string; to?: string };

function allowed(session: SessionUser, slug: Permission): boolean {
  return assistantModuleAllowed(session.permissions, session.isSuperAdmin, slug);
}

function toRequestPreset(preset?: string): RequestDatePreset {
  const known: RequestDatePreset[] = [
    "today",
    "this_week",
    "last_week",
    "this_month",
    "last_month",
    "all",
  ];
  if (preset && (known as string[]).includes(preset)) return preset as RequestDatePreset;
  return "all";
}

async function vehicleById(id: string): Promise<Record<string, unknown> | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vehicles")
    .select(
      "id, bike_id, reg_number, status, vehicle_type_key, condition, car_type, type_of_use, make, model, location_text",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const { data: driver } = await supabase
    .from("drivers")
    .select("id, driver_code, profiles!drivers_id_fkey(full_name)")
    .eq("vehicle_id", id)
    .is("archived_at", null)
    .maybeSingle();
  const profile = Array.isArray(driver?.profiles) ? driver?.profiles[0] : driver?.profiles;
  return {
    ...data,
    assigned_driver_id: driver?.id ?? null,
    assigned_driver_code: driver?.driver_code ?? null,
    assigned_driver_name: (profile as { full_name?: string } | null)?.full_name ?? null,
  };
}

async function deliveryById(id: string): Promise<Record<string, unknown> | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deliveries")
    .select("id, status, external_order_id, driver_id, created_at, delivered_at, partner_id")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function countDriversInZone(zoneId: string): Promise<{ count: number; head: Record<string, unknown>[] }> {
  const supabase = await createClient();
  const countRes = await supabase
    .from("drivers")
    .select("id", { count: "exact", head: true })
    .eq("zone_id", zoneId)
    .is("archived_at", null);
  const { data } = await supabase
    .from("drivers")
    .select("id, driver_code, profiles!drivers_id_fkey(full_name)")
    .eq("zone_id", zoneId)
    .is("archived_at", null)
    .limit(ASSISTANT_LIST_CAP);
  return {
    count: countRes.count ?? 0,
    head: (data ?? []).map((row) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        id: row.id,
        driver_code: row.driver_code,
        name: (profile as { full_name?: string } | null)?.full_name ?? null,
      };
    }),
  };
}

async function restaurantsInZone(zoneId: string): Promise<{ count: number; head: Record<string, unknown>[] }> {
  const supabase = await createClient();
  const countRes = await supabase
    .from("restaurants")
    .select("id", { count: "exact", head: true })
    .eq("zone_id", zoneId);
  const { data } = await supabase
    .from("restaurants")
    .select("id, name, status")
    .eq("zone_id", zoneId)
    .order("name")
    .limit(ASSISTANT_LIST_CAP);
  return { count: countRes.count ?? 0, head: data ?? [] };
}

async function vehicleConditionCounts(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase.from("vehicles").select("condition");
  const counts: Record<string, number> = { total: data?.length ?? 0 };
  for (const row of data ?? []) {
    const key = String(row.condition ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function driverReport(session: SessionUser, id: string, range: { from: string; to: string }) {
  const showContact = allowed(session, "drivers.view");
  const detail = allowed(session, "drivers.view") ? await fetchDriverDetail(id) : null;
  const summary = detail
    ? stripDriverIdentity(detail as unknown as Record<string, unknown>, { showContact })
    : sectionDenied("/drivers");

  const sections: Record<string, unknown> = { summary };

  const tasks: Array<Promise<void>> = [];

  if (allowed(session, "driver_groups.view")) {
    tasks.push(
      listGroupsForDriver(id)
        .then((groups) => {
          sections.groups = groups.map((g) => ({ id: g.id, name: g.name }));
        })
        .catch(() => {
          sections.groups = sectionUnavailable("groups_failed");
        }),
    );
  } else {
    sections.groups = sectionDenied("/drivers");
  }

  if (detail && typeof detail === "object" && "vehicle_id" in detail && detail.vehicle_id) {
    tasks.push(
      vehicleById(String(detail.vehicle_id)).then((vehicle) => {
        sections.vehicle = vehicle ? stripVehicleRow(vehicle) : null;
      }),
    );
  }

  if (allowed(session, "performance.view")) {
    tasks.push(
      Promise.all([
        fetchDriverPerformanceDetail(id, range.from, range.to),
        fetchDriverPerformanceRank(id, range.from, range.to),
      ]).then(([row, rank]) => {
        sections.performance = row
          ? {
              ...stripPerformanceRow(row as unknown as Record<string, unknown>),
              band: rank.band,
              rank: rank.rank,
              total: rank.total,
              window: range,
            }
          : { window: range, empty: true };
      }),
    );
  } else {
    sections.performance = sectionDenied("/performance");
  }

  if (allowed(session, "deliveries.view")) {
    const bounds = kuwaitDayCreatedAtBounds(range.from, range.to);
    tasks.push(
      Promise.all([
        countDeliveriesByFilters({
          dateFrom: bounds.dateFrom,
          dateTo: bounds.dateTo,
          driverId: id,
        }),
        fetchRecentDeliveriesForDriver(id, 10),
      ]).then(([counts, head]) => {
        sections.deliveries = {
          counts: {
            total: counts.total,
            verified: counts.verified,
            pending: counts.pending,
            rejected: counts.rejected,
            cancelled: counts.cancelled,
            in_transit: counts.in_transit,
            under_review: counts.under_review,
          },
          head: head.map((row) => stripDeliveryHead(row as unknown as Record<string, unknown>)),
          window: range,
        };
      }),
    );
  } else {
    sections.deliveries = sectionDenied("/deliveries");
  }

  if (allowed(session, "attendance.view")) {
    tasks.push(
      fetchDriverAttendanceRange(id, range.from, range.to).then((days) => {
        sections.attendance = {
          window: range,
          days: days.slice(0, ASSISTANT_LIST_CAP).map((day) =>
            stripAttendanceDay(day as unknown as Record<string, unknown>),
          ),
          count: days.length,
        };
      }),
    );
  } else {
    sections.attendance = sectionDenied("/attendance");
  }

  if (allowed(session, "requests.view")) {
    const search = detail && "driver_code" in detail ? String(detail.driver_code ?? "") : id;
    tasks.push(
      Promise.all([
        fetchAdminRequestsList({
          datePreset: toRequestPreset("all"),
          search,
          limit: 10,
          offset: 0,
        }),
        fetchAdminRequestsList({
          datePreset: toRequestPreset("all"),
          search,
          type: "complaint",
          limit: 10,
          offset: 0,
        }),
      ]).then(([all, complaints]) => {
        sections.requests = {
          kpi: all.kpi,
          count: all.filteredTotal,
          head: all.rows.map((row) => stripRequestRow(row as unknown as Record<string, unknown>)),
        };
        sections.complaints = {
          kpi: complaints.kpi,
          count: complaints.filteredTotal,
          head: complaints.rows.map((row) => stripRequestRow(row as unknown as Record<string, unknown>)),
        };
      }),
    );
  } else {
    sections.requests = sectionDenied("/requests");
    sections.complaints = sectionDenied("/requests");
  }

  if (allowed(session, "payroll.view")) {
    tasks.push(
      fetchPayrollMonthSnapshot({ monthKey: monthKeyFromYmd(range.to) }).then((snap) => {
        const rider = snap.riders.find((row) => row.driverId === id);
        sections.payroll = {
          month: snap.month,
          kpis: snap.payrollKpis,
          rider: rider
            ? {
                name: rider.name,
                amId: rider.amId,
                workDays: rider.workDays,
                totalHours: rider.totalHours,
                absentDays: rider.absentDays,
                sickDays: rider.sickDays,
                efficiency: rider.efficiency,
                status: rider.status,
              }
            : null,
        };
      }),
    );
  } else {
    sections.payroll = sectionDenied("/payroll");
  }

  if (allowed(session, "earnings.view")) {
    tasks.push(
      fetchIncentiveDailyReport({ from: range.from, to: range.to, driverId: id }).then((report) => {
        const first = report.rows[0];
        sections.incentives = {
          from: report.from,
          to: report.to,
          rider: first
            ? { name: first.driver_name, driver_code: first.driver_code, employee_id: first.employee_id }
            : null,
          days: report.rows.slice(0, ASSISTANT_LIST_CAP).map((row) => ({
            earn_date: row.earn_date,
            restaurant_name: row.restaurant_name,
            deliveries: row.deliveries,
            daily_amount_kwd: row.daily_amount_kwd,
          })),
          total_kwd: report.rows.reduce((sum, row) => sum + row.daily_amount_kwd, 0),
        };
      }),
    );
  } else {
    sections.incentives = sectionDenied("/earnings");
  }

  if (allowed(session, "driver_ops.view")) {
    tasks.push(
      fetchDriverOperationTimeline(id, 10).then((events) => {
        sections.activity = events.map((event) => stripActivityEvent(event as unknown as Record<string, unknown>));
      }),
    );
  } else {
    sections.activity = sectionDenied("/drivers");
  }

  await Promise.all(tasks);
  const zoneId =
    detail && typeof detail === "object" && "zone_id" in detail ? String(detail.zone_id || "") || undefined : undefined;
  return {
    entity: { type: "driver" as const, id, label: detail?.full_name ?? undefined, zone_id: zoneId },
    window: range,
    sections,
    focus: { entity_type: "driver" as const, id, label: detail?.full_name ?? undefined, zone_id: zoneId, driver_id: id },
  };
}

async function zoneReport(session: SessionUser, id: string, range: { from: string; to: string }) {
  const zones = allowed(session, "zones.view") ? await listZonesForAssistant() : [];
  const zone = zones.find((row) => row.id === id);
  if (!zone && !allowed(session, "zones.view")) {
    return { entity: { type: "zone", id }, window: range, sections: { summary: sectionDenied("/zones") } };
  }
  const sections: Record<string, unknown> = {
    summary: zone ?? { id },
  };
  if (allowed(session, "restaurants.view")) {
    sections.restaurants = await restaurantsInZone(id);
  } else {
    sections.restaurants = sectionDenied("/restaurants");
  }
  if (allowed(session, "requests.view")) {
    const pending = await fetchAdminRequestsList({
      datePreset: "all",
      zoneId: id,
      limit: 10,
      offset: 0,
    });
    sections.requests = {
      kpi: pending.kpi,
      status_counts: pending.statusCounts,
      count: pending.filteredTotal,
      head: pending.rows.map((row) => stripRequestRow(row as unknown as Record<string, unknown>)),
    };
  } else {
    sections.requests = sectionDenied("/requests");
  }
  if (allowed(session, "drivers.view")) {
    sections.drivers = await countDriversInZone(id);
  } else {
    sections.drivers = sectionDenied("/drivers");
  }
  return {
    entity: { type: "zone" as const, id, label: zone?.name },
    window: range,
    sections,
    focus: { entity_type: "zone" as const, id, label: zone?.name, zone_id: id },
  };
}

async function restaurantReport(session: SessionUser, id: string, range: { from: string; to: string }) {
  const sections: Record<string, unknown> = {};
  if (!allowed(session, "restaurants.view")) {
    return { entity: { type: "restaurant", id }, window: range, sections: { summary: sectionDenied("/restaurants") } };
  }
  const detail = await fetchRestaurantDetail(id);
  if (!detail) {
    return { entity: { type: "restaurant", id }, window: range, sections: { summary: sectionUnavailable("not_found") } };
  }
  sections.summary = {
    id: detail.id,
    name: detail.name,
    status: detail.status,
    partner_name: detail.partner_name,
    zone_name: detail.zone_name,
    zone_id: detail.zone_id,
    driver_count: detail.driver_count,
  };
  if (allowed(session, "drivers.view") || allowed(session, "restaurants.view")) {
    const assigned = await fetchRestaurantAssignedDrivers(id);
    const showPhone = allowed(session, "drivers.view");
    sections.assigned_drivers = {
      count: assigned.length,
      head: assigned.slice(0, ASSISTANT_LIST_CAP).map((row) => ({
        driver_id: row.driver_id,
        name: row.name,
        driver_code: row.driver_code,
        is_on_duty: row.is_on_duty,
        ...(showPhone && row.phone ? { phone: row.phone } : {}),
      })),
    };
  }
  if (allowed(session, "deliveries.view")) {
    const bounds = kuwaitDayCreatedAtBounds(range.from, range.to);
    const counts = await countDeliveriesByFilters({
      dateFrom: bounds.dateFrom,
      dateTo: bounds.dateTo,
      restaurantId: id,
    });
    sections.deliveries = {
      total: counts.total,
      verified: counts.verified,
      pending: counts.pending,
      rejected: counts.rejected,
      cancelled: counts.cancelled,
      in_transit: counts.in_transit,
    };
  } else {
    sections.deliveries = sectionDenied("/deliveries");
  }
  if (allowed(session, "performance.view") && detail.zone_id) {
    const snap = await fetchPerformanceOpsSnapshot({
      from: range.from,
      to: range.to,
      granularity: "daily",
      slicers: { ...EMPTY_OPS_SLICERS, restaurantIds: [id] },
      outsourceOnly: false,
    });
    sections.kpi = snap.kpis;
  }
  return {
    entity: { type: "restaurant" as const, id, label: detail.name, zone_id: detail.zone_id ?? undefined },
    window: range,
    sections,
    focus: {
      entity_type: "restaurant" as const,
      id,
      label: detail.name,
      zone_id: detail.zone_id ?? undefined,
    },
  };
}

export async function buildEntityReport(input: {
  entity_type: AssistantEntityType;
  id: string;
  range?: DateInput;
  summaryOnly?: boolean;
}) {
  const session = await requireAssistantModule(ENTITY_MODULE_PERMISSION[input.entity_type]);
  const range = resolveAssistantDateRange(input.range ?? { preset: "this_month" });
  void logAdminRead("assistant", "assistant.tool", {
    tool: input.summaryOnly ? "entity_summary" : "entity_report",
    entity_type: input.entity_type,
    id: input.id,
    window: range,
  });

  switch (input.entity_type) {
    case "driver": {
      const report = await driverReport(session, input.id, range);
      if (input.summaryOnly) return { ...report, sections: { summary: report.sections.summary } };
      return report;
    }
    case "zone": {
      const report = await zoneReport(session, input.id, range);
      if (input.summaryOnly) return { ...report, sections: { summary: report.sections.summary } };
      return report;
    }
    case "restaurant": {
      const report = await restaurantReport(session, input.id, range);
      if (input.summaryOnly) return { ...report, sections: { summary: report.sections.summary } };
      return report;
    }
    case "vehicle": {
      const row = await vehicleById(input.id);
      const summary = row ? stripVehicleRow(row) : sectionUnavailable("not_found");
      return {
        entity: { type: "vehicle", id: input.id, label: row ? String(row.bike_id) : undefined },
        window: range,
        sections: { summary },
        focus: { entity_type: "vehicle" as const, id: input.id, label: row ? String(row.bike_id) : undefined },
      };
    }
    case "request":
    case "complaint": {
      const detail = await fetchAdminRequestDetail(input.id);
      const req = detail.request;
      const summary = req
        ? {
            id: req.id,
            request_code: req.request_code,
            request_type: req.request_type,
            status: req.status,
            current_step_label: req.current_step_label,
            amount_kwd: req.amount_kwd,
            start_date: req.start_date,
            end_date: req.end_date,
            created_at: req.created_at,
            driver_id: req.driver_id,
            driver_code: req.requester?.code ?? null,
            driver_name: req.requester?.name ?? null,
          }
        : sectionUnavailable(detail.error ?? "not_found");
      return {
        entity: { type: input.entity_type, id: input.id, label: req?.request_code },
        window: range,
        sections: { summary },
        focus: {
          entity_type: input.entity_type,
          id: input.id,
          label: req?.request_code,
          driver_id: req?.driver_id || undefined,
        },
      };
    }
    case "delivery": {
      const row = await deliveryById(input.id);
      return {
        entity: { type: "delivery", id: input.id },
        window: range,
        sections: { summary: row ? stripDeliveryHead(row) : sectionUnavailable("not_found") },
        focus: {
          entity_type: "delivery" as const,
          id: input.id,
          driver_id: row?.driver_id ? String(row.driver_id) : undefined,
        },
      };
    }
    case "attendance": {
      if (/^\d{4}-\d{2}-\d{2}$/.test(input.id)) {
        return {
          entity: { type: "attendance", id: input.id },
          window: range,
          sections: { summary: sectionUnavailable("resolve_a_driver_for_attendance") },
        };
      }
      if (!allowed(session, "attendance.view")) {
        return { entity: { type: "attendance", id: input.id }, sections: { summary: sectionDenied("/attendance") } };
      }
      const days = await fetchDriverAttendanceRange(input.id, range.from, range.to);
      return {
        entity: { type: "attendance", id: input.id },
        window: range,
        sections: {
          summary: { driver_id: input.id, count: days.length },
          days: days.slice(0, ASSISTANT_LIST_CAP).map((day) =>
            stripAttendanceDay(day as unknown as Record<string, unknown>),
          ),
        },
        focus: { entity_type: "driver" as const, id: input.id, driver_id: input.id },
      };
    }
    case "payroll": {
      if (!allowed(session, "payroll.view")) {
        return { entity: { type: "payroll", id: input.id }, sections: { summary: sectionDenied("/payroll") } };
      }
      const monthKey = /^\d{4}-\d{2}$/.test(input.id) ? input.id : monthKeyFromYmd(range.to);
      const snap = await fetchPayrollMonthSnapshot({ monthKey });
      const rider = /^\d{4}-\d{2}$/.test(input.id)
        ? null
        : snap.riders.find((row) => row.driverId === input.id) ?? null;
      return {
        entity: { type: "payroll", id: input.id },
        window: range,
        sections: {
          summary: { month: snap.month, kpis: snap.payrollKpis, request_kpis: snap.requestKpis },
          rider: rider
            ? {
                name: rider.name,
                workDays: rider.workDays,
                absentDays: rider.absentDays,
                efficiency: rider.efficiency,
              }
            : null,
        },
        focus: {
          entity_type: rider ? "driver" : "payroll",
          id: rider ? rider.driverId : input.id,
          driver_id: rider?.driverId,
        },
      };
    }
    case "driver_group": {
      const group = await getDriverGroup(input.id);
      return {
        entity: { type: "driver_group", id: input.id, label: group?.name },
        window: range,
        sections: {
          summary: group
            ? {
                id: group.id,
                name: group.name,
                member_count: group.members.length,
                members: group.members.slice(0, ASSISTANT_LIST_CAP).map((m) => ({
                  id: m.id,
                  driver_code: m.driver_code,
                  name: m.full_name,
                })),
              }
            : sectionUnavailable("not_found"),
        },
        focus: { entity_type: "driver_group" as const, id: input.id, label: group?.name },
      };
    }
    case "partner": {
      const partners = await fetchPartnersForAdmin();
      const row = partners.find((p) => p.id === input.id);
      return {
        entity: { type: "partner", id: input.id, label: row?.name },
        window: range,
        sections: {
          summary: row ? { id: row.id, name: row.name, driver_count: row.driver_count } : sectionUnavailable("not_found"),
        },
        focus: { entity_type: "partner" as const, id: input.id, label: row?.name },
      };
    }
    case "asset": {
      const asset = await fetchAssetDetail(input.id);
      return {
        entity: { type: "asset", id: input.id, label: asset?.name },
        window: range,
        sections: {
          summary: asset
            ? {
                id: asset.id,
                name: asset.name,
                code: asset.code,
                category: asset.category,
                total_quantity: asset.total_quantity,
                assigned_qty: asset.assigned_qty,
                available_qty: asset.available_qty,
                holder_count: asset.holder_count,
                holders: asset.active_assignments.slice(0, ASSISTANT_LIST_CAP).map((a) => ({
                  holder_name: a.holder_name,
                  holder_code: a.holder_code,
                  quantity: a.quantity,
                })),
              }
            : sectionUnavailable("not_found"),
        },
        focus: { entity_type: "asset" as const, id: input.id, label: asset?.name },
      };
    }
    case "notification": {
      const row = await getNotificationCampaign(input.id);
      return {
        entity: { type: "notification", id: input.id, label: row?.title },
        window: range,
        sections: {
          summary: row
            ? stripNotificationRow(row as unknown as Record<string, unknown>)
            : sectionUnavailable("not_found"),
        },
        focus: { entity_type: "notification" as const, id: input.id, label: row?.title },
      };
    }
    case "performance": {
      if (!allowed(session, "performance.view")) {
        return { entity: { type: "performance", id: input.id }, sections: { summary: sectionDenied("/performance") } };
      }
      const row = await fetchDriverPerformanceDetail(input.id, range.from, range.to);
      const rank = row ? await fetchDriverPerformanceRank(input.id, range.from, range.to) : null;
      return {
        entity: { type: "performance", id: input.id },
        window: range,
        sections: {
          summary: row
            ? { ...stripPerformanceRow(row as unknown as Record<string, unknown>), band: rank?.band, rank: rank?.rank }
            : sectionUnavailable("not_found"),
        },
        focus: { entity_type: "driver" as const, id: input.id, driver_id: input.id },
      };
    }
    case "fleet": {
      const [ops, vehicles] = await Promise.all([
        allowed(session, "attendance.view") ? fetchFleetOpsCounts() : Promise.resolve(sectionDenied("/attendance")),
        allowed(session, "vehicles.view") ? vehicleConditionCounts() : Promise.resolve(sectionDenied("/vehicles")),
      ]);
      return {
        entity: { type: "fleet", id: FLEET_ENTITY_ID, label: "Fleet" },
        window: range,
        sections: { ops, vehicles },
        focus: { entity_type: "fleet" as const, id: FLEET_ENTITY_ID, label: "Fleet" },
      };
    }
    default:
      return { entity: { type: input.entity_type, id: input.id }, sections: { summary: sectionUnavailable("unknown") } };
  }
}

export async function buildEntitySummary(entity_type: AssistantEntityType, id: string) {
  return buildEntityReport({ entity_type, id, summaryOnly: true });
}
