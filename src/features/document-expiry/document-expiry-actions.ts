"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { getPresignedGetUrl } from "@/lib/storage/r2-client";
import type { DocumentExpiryRow, DocumentExpirySummary } from "./document-expiry-utils";
import { bucketDocumentExpiryRow, kuwaitToday } from "./document-expiry-utils";

async function requireDocumentsView() {
  const session = await getSessionUser();
  if (!session) return { error: "not_authorized" as const };
  if (
    !hasPermissionInSet(session.permissions, "documents.view", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export async function fetchDocumentExpiryDashboard(): Promise<{
  rows: DocumentExpiryRow[];
  summary: DocumentExpirySummary;
  error?: string;
}> {
  const auth = await requireDocumentsView();
  if ("error" in auth) return { rows: [], summary: emptySummary(), error: auth.error };

  const supabase = await createClient();
  const { data: trackingRows, error } = await supabase
    .from("document_tracking")
    .select(
      "id, intake_id, driver_id, doc_type, expires_at, track_expiry, notify_enabled, notify_lead_days, object_key",
    )
    .eq("track_expiry", true)
    .not("expires_at", "is", null)
    .order("expires_at", { ascending: true });

  if (error) return { rows: [], summary: emptySummary(), error: "save_failed" };

  const driverIds = [
    ...new Set((trackingRows ?? []).map((row) => row.driver_id).filter(Boolean)),
  ] as string[];
  const intakeIds = [
    ...new Set((trackingRows ?? []).map((row) => row.intake_id).filter(Boolean)),
  ] as string[];

  const [{ data: drivers }, { data: intakes }] = await Promise.all([
    driverIds.length
      ? supabase
          .from("drivers")
          .select("id, driver_code, archived_at, profiles(full_name, phone)")
          .in("id", driverIds)
      : Promise.resolve({ data: [] }),
    intakeIds.length
      ? supabase
          .from("driver_intakes")
          .select("id, full_name, phone, driver_code, linked_profile_id, archived_at")
          .in("id", intakeIds)
      : Promise.resolve({ data: [] }),
  ]);

  const driverMap = new Map((drivers ?? []).map((row) => [row.id, row]));
  const intakeMap = new Map((intakes ?? []).map((row) => [row.id, row]));
  const today = kuwaitToday();

  const rows: DocumentExpiryRow[] = [];
  for (const row of trackingRows ?? []) {
    const bucket = bucketDocumentExpiryRow(String(row.expires_at), today);
    if (!bucket) continue;

    const driver = row.driver_id ? driverMap.get(row.driver_id) : null;
    const intake = row.intake_id ? intakeMap.get(row.intake_id) : null;
    const profileRaw = driver?.profiles as
      | { full_name?: string; phone?: string }
      | { full_name?: string; phone?: string }[]
      | null;
    const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;
    const driverName = profile?.full_name ?? intake?.full_name ?? "—";
    const driverCode = driver?.driver_code ?? intake?.driver_code ?? "—";
    const phone = profile?.phone ?? intake?.phone ?? null;
    const detailDriverId = row.driver_id ?? intake?.linked_profile_id ?? null;
    const intakeId = row.intake_id ?? intake?.id ?? null;

    if (driver?.archived_at || intake?.archived_at) continue;

    rows.push({
      id: row.id,
      bucket,
      docType: row.doc_type,
      expiresAt: String(row.expires_at),
      daysUntil: bucket === "expired"
        ? Math.round(
            (new Date(`${String(row.expires_at)}T00:00:00`).getTime() -
              new Date(`${today}T00:00:00`).getTime()) /
              86_400_000,
          )
        : Math.round(
            (new Date(`${String(row.expires_at)}T00:00:00`).getTime() -
              new Date(`${today}T00:00:00`).getTime()) /
              86_400_000,
          ),
      driverId: detailDriverId,
      intakeId,
      driverName,
      driverCode,
      phone,
      objectKey: row.object_key,
      notifyEnabled: row.notify_enabled,
      notifyLeadDays: (row.notify_lead_days ?? []) as number[],
    });
  }

  const summary: DocumentExpirySummary = {
    expired: rows.filter((row) => row.bucket === "expired").length,
    week: rows.filter((row) => row.bucket === "week").length,
    month: rows.filter((row) => row.bucket === "month").length,
    quarter: rows.filter((row) => row.bucket === "quarter").length,
  };

  return { rows, summary };
}

export async function fetchDocumentExpirySignedUrl(
  objectKey: string,
): Promise<{ url?: string; error?: string }> {
  const auth = await requireDocumentsView();
  if ("error" in auth) return { error: auth.error };
  if (!objectKey.trim()) return { error: "missing_fields" };
  try {
    const url = await getPresignedGetUrl(objectKey.trim(), 900);
    return { url };
  } catch {
    return { error: "save_failed" };
  }
}

function emptySummary(): DocumentExpirySummary {
  return { expired: 0, week: 0, month: 0, quarter: 0 };
}
