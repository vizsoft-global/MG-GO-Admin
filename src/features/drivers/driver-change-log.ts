import { getSessionUser } from "@/lib/auth/get-session";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";
import {
  diffDriverChange,
  displayChangeValue,
  flattenProfileSnapshot,
  sanitizeDriverChangeContext,
  shouldInsertDriverChange,
  type DriverChangeSnapshot,
  type DriverChangeSource,
} from "./driver-change-log-shared";

export {
  DRIVER_CHANGE_SOURCES,
  diffDriverChange,
  displayChangeValue,
  flattenProfileSnapshot,
  sanitizeDriverChangeContext,
  shouldInsertDriverChange,
} from "./driver-change-log-shared";
export type {
  DriverChangeEntry,
  DriverChangeSnapshot,
  DriverChangeSource,
  DriverChangeValue,
} from "./driver-change-log-shared";

type QueryClient = {
  // PostgREST builder is too wide to model here; callers pass the staff or admin client.
  from: (table: string) => any;
};

export async function loadChangeLabels(
  supabase: QueryClient,
  input: {
    zoneId?: string | null;
    partnerId?: string | null;
    vehicleId?: string | null;
    restaurantIds?: string[];
  },
): Promise<{
  zone: string | null;
  partner: string | null;
  vehicle: string | null;
  restaurants: string | null;
}> {
  const restaurantIds = (input.restaurantIds ?? []).filter(Boolean);
  const [zone, partner, vehicle, restaurants] = await Promise.all([
    input.zoneId
      ? supabase.from("zones").select("name").eq("id", input.zoneId).maybeSingle()
      : Promise.resolve({ data: null }),
    input.partnerId
      ? supabase.from("partners").select("name").eq("id", input.partnerId).maybeSingle()
      : Promise.resolve({ data: null }),
    input.vehicleId
      ? supabase
          .from("vehicles")
          .select("bike_id, reg_number")
          .eq("id", input.vehicleId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    restaurantIds.length > 0
      ? supabase.from("restaurants").select("id, name").in("id", restaurantIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const restaurantNameById = new Map(
    (restaurants.data ?? []).map((row: { id: unknown; name?: unknown }) => [
      String(row.id),
      String(row.name ?? ""),
    ]),
  );
  const restaurantNames = restaurantIds
    .map((id) => restaurantNameById.get(id) ?? "")
    .filter(Boolean);

  const vehicleRow = vehicle.data;
  const vehicleLabel = vehicleRow
    ? displayChangeValue(vehicleRow.bike_id) ?? displayChangeValue(vehicleRow.reg_number)
    : null;

  return {
    zone: displayChangeValue(zone.data?.name),
    partner: displayChangeValue(partner.data?.name),
    vehicle: vehicleLabel,
    restaurants: displayChangeValue(restaurantNames),
  };
}

export async function loadIntakeProfileSnapshot(
  supabase: QueryClient,
  intakeId: string,
): Promise<{ snapshot: DriverChangeSnapshot; driverId: string | null } | null> {
  const { data: intake } = await supabase
    .from("driver_intakes")
    .select(
      "id, full_name, phone, civil_id, employee_id, driver_code, partner_id, zone_id, vehicle_id, nationality, rider_category, client_id, client_name, workflow_status, linked_profile_id, custom_fields",
    )
    .eq("id", intakeId)
    .maybeSingle();
  if (!intake) return null;

  const { data: restaurantRows } = await supabase
    .from("driver_intake_restaurants")
    .select("restaurant_id")
    .eq("intake_id", intakeId);
  const restaurantIds = (restaurantRows ?? []).map((row: { restaurant_id: string }) => row.restaurant_id);

  let accountStatus: string | null = null;
  if (intake.linked_profile_id) {
    const { data: driver } = await supabase
      .from("drivers")
      .select("status")
      .eq("id", intake.linked_profile_id)
      .maybeSingle();
    accountStatus = displayChangeValue(driver?.status);
  }

  const labels = await loadChangeLabels(supabase, {
    zoneId: intake.zone_id,
    partnerId: intake.partner_id,
    vehicleId: intake.vehicle_id,
    restaurantIds,
  });

  const custom =
    intake.custom_fields && typeof intake.custom_fields === "object" && !Array.isArray(intake.custom_fields)
      ? (intake.custom_fields as Record<string, unknown>)
      : {};

  return {
    driverId: intake.linked_profile_id ?? null,
    snapshot: flattenProfileSnapshot({
      full_name: intake.full_name,
      phone: intake.phone,
      civil_id: intake.civil_id,
      employee_id: intake.employee_id,
      driver_code: intake.driver_code,
      partner: labels.partner,
      zone: labels.zone,
      restaurants: labels.restaurants,
      vehicle: labels.vehicle,
      nationality: intake.nationality,
      rider_category: intake.rider_category,
      client_id: intake.client_id,
      client_name: intake.client_name,
      workflow_status: intake.workflow_status,
      account_status: accountStatus,
      custom_fields: custom,
    }),
  };
}

export async function resolveIntakeIdForDriver(
  supabase: QueryClient,
  driverId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("driver_intakes")
    .select("id, linked_profile_id")
    .eq("linked_profile_id", driverId)
    .maybeSingle();
  return data?.id ?? null;
}

export async function logDriverChange(input: {
  intakeId: string;
  driverId?: string | null;
  source: DriverChangeSource;
  before?: DriverChangeSnapshot;
  after?: DriverChangeSnapshot;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    const changes = diffDriverChange(input.before ?? {}, input.after ?? {});
    if (!shouldInsertDriverChange(input.source, changes)) return;

    const session = await getSessionUser();
    if (!session) return;

    const actorName =
      displayChangeValue(session.profile.full_name) ??
      displayChangeValue(session.email) ??
      "Staff";
    const context = sanitizeDriverChangeContext(input.context);
    if (
      (input.source === "passcode" ||
        input.source === "archive" ||
        input.source === "restore" ||
        input.source === "approve") &&
      changes.length === 0 &&
      !context.note
    ) {
      context.note =
        input.source === "passcode" ? "passcode replaced" : input.source;
    }

    const admin = createAdminClient();
    const { error } = await admin.from("driver_change_events").insert({
      intake_id: input.intakeId,
      driver_id: input.driverId ?? null,
      actor_id: session.id,
      actor_name: actorName,
      source: input.source,
      changes: changes as unknown as Json,
      context: context as Json,
    });
    if (error) return;

    void logAdminMutation({
      action:
        input.source === "manual_create" || input.source === "bulk_import"
          ? "create"
          : input.source === "archive"
            ? "delete"
            : "update",
      entityType: "driver_change",
      entityId: input.intakeId,
      routeName: "logDriverChange",
      context: { source: input.source },
      after: { source: input.source, fields: changes.map((c) => c.field) },
    });
  } catch {
    /* best-effort — never block the save */
  }
}
