"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";

export type VisitListRow = {
  id: string;
  booking_code: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string | null;
  driver_code: string;
  department_key: string;
  department_label: string;
  branch_id: string | null;
  branch_name: string | null;
  slot_id: string;
  slot_start: string | null;
  slot_end: string | null;
  scheduled_date: string;
  status: string;
  note: string | null;
  created_at: string;
  checked_in_at: string | null;
};

export type VisitKpis = {
  today: number;
  today_checked_in: number;
  upcoming: number;
  awaiting_checkin: number;
  no_shows: number;
};

export type VisitDetailRow = VisitListRow & {
  branch_id: string | null;
  branch_name: string | null;
  slot_id: string;
  slot_start: string | null;
  slot_end: string | null;
  checked_in_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
};

export type VisitDepartmentRow = {
  id: string;
  key: string;
  label_en: string;
  label_ar: string | null;
  is_active: boolean;
  sort_order: number;
  desk_location: string | null;
  assigned_staff_name: string | null;
  avg_handling_minutes: number | null;
};

export type VisitBranchRow = {
  id: string;
  key: string;
  name: string;
  address: string | null;
  city: string | null;
  working_days: string | null;
  opening_time: string | null;
  closing_time: string | null;
  desks_count: number;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
};

export type VisitSlotRow = {
  id: string;
  branch_id: string | null;
  branch_name: string | null;
  department_key: string;
  department_label: string;
  slot_date: string | null;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  capacity: number;
  is_active: boolean;
};

async function requireVisitsView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "visits.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireVisitsOperate() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "visits.operate", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireVisitsManageCatalog() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(
      session.permissions,
      "visits.manage_catalog",
      session.isSuperAdmin,
    )
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

export async function fetchAdminVisitsList(input?: {
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number;
  offset?: number;
}): Promise<{ rows: VisitListRow[]; kpi: VisitKpis; error?: string }> {
  await requireVisitsView();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_visits", {
    p_date_from: input?.dateFrom || undefined,
    p_date_to: input?.dateTo || undefined,
    p_status: input?.status || undefined,
    p_limit: input?.limit ?? 50,
    p_offset: input?.offset ?? 0,
  });

  const emptyKpi: VisitKpis = {
    today: 0,
    today_checked_in: 0,
    upcoming: 0,
    awaiting_checkin: 0,
    no_shows: 0,
  };

  if (error) return { rows: [], kpi: emptyKpi, error: error.message };
  const payload = data as {
    ok?: boolean;
    rows?: unknown[];
    kpi?: Record<string, unknown>;
    error?: string;
  };
  if (payload?.ok === false) {
    return { rows: [], kpi: emptyKpi, error: payload.error ?? "failed" };
  }

  const rows = (payload?.rows ?? []).map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      id: String(r.id),
      booking_code: String(r.booking_code ?? ""),
      driver_id: String(r.driver_id ?? ""),
      driver_name: String(r.driver_name ?? "—"),
      driver_phone: r.driver_phone != null ? String(r.driver_phone) : null,
      driver_code: String(r.driver_code ?? ""),
      department_key: String(r.department_key ?? ""),
      department_label: String(r.department_label ?? r.department_key ?? ""),
      branch_id: r.branch_id != null ? String(r.branch_id) : null,
      branch_name: r.branch_name != null ? String(r.branch_name) : null,
      slot_id: String(r.slot_id ?? ""),
      slot_start: r.slot_start != null ? String(r.slot_start) : null,
      slot_end: r.slot_end != null ? String(r.slot_end) : null,
      scheduled_date: String(r.scheduled_date ?? ""),
      status: String(r.status ?? ""),
      note: r.note != null ? String(r.note) : null,
      created_at: String(r.created_at ?? ""),
      checked_in_at: r.checked_in_at != null ? String(r.checked_in_at) : null,
    };
  });

  const kpiRaw = payload?.kpi ?? {};
  const kpi: VisitKpis = {
    today: Number(kpiRaw.today ?? 0),
    today_checked_in: Number(kpiRaw.today_checked_in ?? 0),
    upcoming: Number(kpiRaw.upcoming ?? 0),
    awaiting_checkin: Number(kpiRaw.awaiting_checkin ?? 0),
    no_shows: Number(kpiRaw.no_shows ?? 0),
  };

  return { rows, kpi };
}

export async function fetchAdminVisitDetail(
  bookingId: string,
): Promise<{ visit: VisitDetailRow | null; error?: string }> {
  await requireVisitsView();
  const supabase = await createClient();

  const { data: booking, error } = await supabase
    .from("visit_bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();

  if (error) return { visit: null, error: error.message };
  if (!booking) return { visit: null };

  const [driverRes, profileRes, deptRes, branchRes, slotRes] = await Promise.all([
    supabase.from("drivers").select("driver_code").eq("id", booking.driver_id).maybeSingle(),
    supabase.from("profiles").select("full_name, phone").eq("id", booking.driver_id).maybeSingle(),
    supabase
      .from("visit_departments")
      .select("label_en")
      .eq("key", booking.department_key)
      .maybeSingle(),
    booking.branch_id
      ? supabase.from("visit_branches").select("name").eq("id", booking.branch_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("visit_slots").select("start_time, end_time").eq("id", booking.slot_id).maybeSingle(),
  ]);

  return {
    visit: {
      id: booking.id,
      booking_code: booking.booking_code,
      driver_id: booking.driver_id,
      driver_name: profileRes.data?.full_name ?? "—",
      driver_phone: profileRes.data?.phone ?? null,
      driver_code: driverRes.data?.driver_code ?? "",
      department_key: booking.department_key,
      department_label: deptRes.data?.label_en ?? booking.department_key,
      scheduled_date: booking.scheduled_date,
      status: booking.status,
      note: booking.note,
      created_at: booking.created_at,
      branch_id: booking.branch_id,
      branch_name: branchRes.data?.name ?? null,
      slot_id: booking.slot_id,
      slot_start: slotRes.data?.start_time ?? null,
      slot_end: slotRes.data?.end_time ?? null,
      checked_in_at: booking.checked_in_at,
      completed_at: booking.completed_at,
      cancelled_at: booking.cancelled_at,
      updated_at: booking.updated_at,
    },
  };
}

export async function fetchReceptionVisitsToday(): Promise<{
  rows: VisitListRow[];
  error?: string;
}> {
  await requireVisitsOperate();
  const today = new Date().toISOString().slice(0, 10);
  return fetchAdminVisitsList({
    status: "confirmed",
    dateFrom: today,
    dateTo: today,
    limit: 200,
  });
}

export async function updateAdminVisitStatus(input: {
  bookingId: string;
  status: "confirmed" | "checked_in" | "completed" | "no_show" | "cancelled";
}): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "visits.operate", session.isSuperAdmin)
  ) {
    return { ok: false, error: "not_authorized" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_update_visit_status", {
    p_booking_id: input.bookingId,
    p_status: input.status,
  });
  if (error) return { ok: false, error: error.message };
  const payload = data as { ok?: boolean; error?: string };
  if (payload?.ok === false) return { ok: false, error: payload.error ?? "failed" };
  return { ok: true };
}

export async function fetchVisitDepartments(): Promise<{
  rows: VisitDepartmentRow[];
  error?: string;
}> {
  await requireVisitsView();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visit_departments")
    .select(
      "id, key, label_en, label_ar, is_active, sort_order, desk_location, assigned_staff_name, avg_handling_minutes",
    )
    .order("sort_order");

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as VisitDepartmentRow[] };
}

export async function createVisitDepartment(input: {
  key: string;
  label_en: string;
  label_ar?: string | null;
  desk_location?: string | null;
  assigned_staff_name?: string | null;
  avg_handling_minutes?: number | null;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireVisitsManageCatalog();
  if (!input.key.trim() || !input.label_en.trim()) {
    return { ok: false, error: "key_and_label_required" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visit_departments")
    .insert({
      key: input.key.trim(),
      label_en: input.label_en.trim(),
      label_ar: input.label_ar ?? null,
      desk_location: input.desk_location ?? null,
      assigned_staff_name: input.assigned_staff_name ?? null,
      avg_handling_minutes: input.avg_handling_minutes ?? null,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

export async function updateVisitDepartment(input: {
  id: string;
  is_active?: boolean;
  desk_location?: string | null;
  assigned_staff_name?: string | null;
  avg_handling_minutes?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  await requireVisitsManageCatalog();
  const supabase = await createClient();
  const patch = {
    updated_at: new Date().toISOString(),
    ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
    ...(input.desk_location !== undefined ? { desk_location: input.desk_location } : {}),
    ...(input.assigned_staff_name !== undefined
      ? { assigned_staff_name: input.assigned_staff_name }
      : {}),
    ...(input.avg_handling_minutes !== undefined
      ? { avg_handling_minutes: input.avg_handling_minutes }
      : {}),
  };
  const { error } = await supabase.from("visit_departments").update(patch).eq("id", input.id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchVisitBranches(): Promise<{
  rows: VisitBranchRow[];
  error?: string;
}> {
  await requireVisitsView();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visit_branches")
    .select(
      "id, key, name, address, city, working_days, opening_time, closing_time, desks_count, is_default, is_active, sort_order",
    )
    .order("sort_order");

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as VisitBranchRow[] };
}

export async function createVisitBranch(input: {
  key: string;
  name: string;
  address?: string | null;
  city?: string | null;
  working_days?: string | null;
  opening_time?: string | null;
  closing_time?: string | null;
  desks_count?: number;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireVisitsManageCatalog();
  if (!input.key.trim() || !input.name.trim()) {
    return { ok: false, error: "key_and_name_required" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visit_branches")
    .insert({
      key: input.key.trim(),
      name: input.name.trim(),
      address: input.address ?? null,
      city: input.city ?? null,
      working_days: input.working_days ?? null,
      opening_time: input.opening_time ?? null,
      closing_time: input.closing_time ?? null,
      desks_count: input.desks_count ?? 1,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

export async function updateVisitBranch(input: {
  id: string;
  name?: string;
  address?: string | null;
  city?: string | null;
  working_days?: string | null;
  opening_time?: string | null;
  closing_time?: string | null;
  desks_count?: number;
  is_active?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  await requireVisitsManageCatalog();
  const supabase = await createClient();
  const patch = {
    updated_at: new Date().toISOString(),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.address !== undefined ? { address: input.address } : {}),
    ...(input.city !== undefined ? { city: input.city } : {}),
    ...(input.working_days !== undefined ? { working_days: input.working_days } : {}),
    ...(input.opening_time !== undefined ? { opening_time: input.opening_time } : {}),
    ...(input.closing_time !== undefined ? { closing_time: input.closing_time } : {}),
    ...(input.desks_count !== undefined ? { desks_count: input.desks_count } : {}),
    ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
  };

  const { error } = await supabase.from("visit_branches").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchVisitSlots(): Promise<{
  rows: VisitSlotRow[];
  error?: string;
}> {
  await requireVisitsView();
  const supabase = await createClient();

  const { data: slots, error } = await supabase
    .from("visit_slots")
    .select(
      "id, branch_id, department_key, slot_date, day_of_week, start_time, end_time, capacity, is_active",
    )
    .order("department_key")
    .order("day_of_week", { nullsFirst: false })
    .order("slot_date", { nullsFirst: false })
    .order("start_time");

  if (error) return { rows: [], error: error.message };

  const deptKeys = [
    ...new Set(
      (slots ?? [])
        .map((s) => s.department_key)
        .filter((k): k is string => typeof k === "string" && k.length > 0),
    ),
  ];
  const branchIds = [
    ...new Set(
      (slots ?? [])
        .map((s) => s.branch_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  const [deptsRes, branchesRes] = await Promise.all([
    deptKeys.length
      ? supabase.from("visit_departments").select("key, label_en").in("key", deptKeys)
      : Promise.resolve({ data: [], error: null }),
    branchIds.length
      ? supabase.from("visit_branches").select("id, name").in("id", branchIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const deptMap = new Map((deptsRes.data ?? []).map((d) => [d.key, d.label_en]));
  const branchMap = new Map((branchesRes.data ?? []).map((b) => [b.id, b.name]));

  const rows: VisitSlotRow[] = (slots ?? []).map((s) => ({
    id: s.id,
    branch_id: s.branch_id,
    branch_name: s.branch_id ? (branchMap.get(s.branch_id) ?? null) : null,
    department_key: s.department_key ?? "",
    department_label: deptMap.get(s.department_key ?? "") ?? s.department_key ?? "",
    slot_date: s.slot_date,
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    end_time: s.end_time,
    capacity: s.capacity,
    is_active: s.is_active,
  }));

  return { rows };
}

export async function upsertVisitSlot(input: {
  id?: string;
  department_key: string;
  branch_id?: string | null;
  slot_date?: string | null;
  day_of_week?: number | null;
  start_time: string;
  end_time: string;
  capacity: number;
  is_active?: boolean;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireVisitsManageCatalog();

  if (!input.slot_date && input.day_of_week == null) {
    return { ok: false, error: "date_or_dow_required" };
  }
  if (input.end_time <= input.start_time) {
    return { ok: false, error: "invalid_time_range" };
  }

  const supabase = await createClient();
  const payload = {
    department_key: input.department_key,
    branch_id: input.branch_id ?? null,
    slot_date: input.slot_date ?? null,
    day_of_week: input.day_of_week ?? null,
    start_time: input.start_time,
    end_time: input.end_time,
    capacity: input.capacity,
    is_active: input.is_active ?? true,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await supabase.from("visit_slots").update(payload).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: input.id };
  }

  const { data, error } = await supabase
    .from("visit_slots")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

export async function deactivateVisitSlot(slotId: string): Promise<{ ok: boolean; error?: string }> {
  await requireVisitsManageCatalog();
  const supabase = await createClient();
  const { error } = await supabase
    .from("visit_slots")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", slotId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
