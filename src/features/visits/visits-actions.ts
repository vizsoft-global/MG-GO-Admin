"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";

export type VisitListRow = {
  id: string;
  booking_code: string;
  driver_id: string;
  driver_name: string;
  driver_code: string;
  department_key: string;
  department_label: string;
  scheduled_date: string;
  status: string;
  note: string | null;
  created_at: string;
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

export async function fetchAdminVisitsList(input?: {
  status?: string | null;
  limit?: number;
  offset?: number;
}): Promise<{ rows: VisitListRow[]; error?: string }> {
  await requireVisitsView();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_visits", {
    p_status: input?.status || undefined,
    p_limit: input?.limit ?? 50,
    p_offset: input?.offset ?? 0,
  });

  if (error) return { rows: [], error: error.message };
  const payload = data as { ok?: boolean; rows?: unknown[]; error?: string };
  if (payload?.ok === false) return { rows: [], error: payload.error ?? "failed" };

  const rows = (payload?.rows ?? []).map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      id: String(r.id),
      booking_code: String(r.booking_code ?? ""),
      driver_id: String(r.driver_id ?? ""),
      driver_name: String(r.driver_name ?? "—"),
      driver_code: String(r.driver_code ?? ""),
      department_key: String(r.department_key ?? ""),
      department_label: String(r.department_label ?? r.department_key ?? ""),
      scheduled_date: String(r.scheduled_date ?? ""),
      status: String(r.status ?? ""),
      note: r.note != null ? String(r.note) : null,
      created_at: String(r.created_at ?? ""),
    };
  });

  return { rows };
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
