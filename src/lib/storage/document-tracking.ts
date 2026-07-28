import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_NOTIFY_LEAD_DAYS,
  type DocumentExpiryConfig,
  type DriverDocumentType,
} from "@/features/drivers/types";

export type DocumentTrackingRow = {
  id: string;
  intake_id: string | null;
  driver_id: string | null;
  doc_type: DriverDocumentType;
  expires_at: string | null;
  track_expiry: boolean;
  notify_enabled: boolean;
  notify_lead_days: number[];
  object_key: string | null;
};

export function parseNotifyLeadDays(raw: string | null | undefined): number[] {
  if (!raw?.trim()) return [...DEFAULT_NOTIFY_LEAD_DAYS];
  const parsed = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length > 0 ? parsed : [...DEFAULT_NOTIFY_LEAD_DAYS];
}

export function parseExpiryConfigFromForm(
  formData: FormData,
  docType: DriverDocumentType,
): DocumentExpiryConfig {
  const trackExpiry = String(formData.get(`trackExpiry_${docType}`) ?? "") === "true";
  const expiresAtRaw = String(formData.get(`expiresAt_${docType}`) ?? "").trim();
  const notifyEnabled = String(formData.get(`notifyEnabled_${docType}`) ?? "true") !== "false";
  const notifyLeadDays = parseNotifyLeadDays(
    String(formData.get(`notifyLeadDays_${docType}`) ?? ""),
  );

  return {
    trackExpiry,
    expiresAt: trackExpiry && expiresAtRaw ? expiresAtRaw : null,
    notifyEnabled: trackExpiry && notifyEnabled,
    notifyLeadDays,
  };
}

export function expiryConfigToPayload(config: DocumentExpiryConfig) {
  return {
    track_expiry: config.trackExpiry,
    expires_at: config.trackExpiry ? config.expiresAt : null,
    notify_enabled: config.trackExpiry && config.notifyEnabled,
    notify_lead_days: config.notifyLeadDays,
  };
}

export async function listDocumentTracking(
  intakeId: string,
  driverProfileId: string | null,
): Promise<Partial<Record<DriverDocumentType, DocumentExpiryConfig>>> {
  const supabase = await createClient();
  let query = supabase
    .from("document_tracking")
    .select(
      "doc_type, expires_at, track_expiry, notify_enabled, notify_lead_days, object_key",
    );

  if (driverProfileId) {
    query = query.or(
      `driver_id.eq.${driverProfileId},intake_id.eq.${intakeId}`,
    );
  } else {
    query = query.eq("intake_id", intakeId);
  }

  const { data } = await query;
  const out: Partial<Record<DriverDocumentType, DocumentExpiryConfig>> = {};

  for (const row of data ?? []) {
    const docType = row.doc_type as DriverDocumentType;
    out[docType] = {
      trackExpiry: row.track_expiry,
      expiresAt: row.expires_at,
      notifyEnabled: row.notify_enabled,
      notifyLeadDays: (row.notify_lead_days ?? DEFAULT_NOTIFY_LEAD_DAYS) as number[],
      objectKey: row.object_key,
    };
  }

  return out;
}

export async function upsertDocumentTracking(input: {
  intakeId: string;
  driverProfileId: string | null;
  docType: DriverDocumentType;
  objectKey?: string | null;
  expiry: DocumentExpiryConfig;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const payload = expiryConfigToPayload(input.expiry);
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("document_tracking")
    .select("id, intake_id, driver_id")
    .or(
      input.driverProfileId
        ? `driver_id.eq.${input.driverProfileId},intake_id.eq.${input.intakeId}`
        : `intake_id.eq.${input.intakeId}`,
    )
    .eq("doc_type", input.docType)
    .maybeSingle();

  const row = {
    intake_id: input.intakeId,
    driver_id: input.driverProfileId,
    doc_type: input.docType,
    object_key: input.objectKey ?? null,
    updated_at: now,
    ...payload,
  };

  if (existing?.id) {
    const { error } = await supabase
      .from("document_tracking")
      .update(row)
      .eq("id", existing.id);
    if (error) return { error: "save_failed" };
  } else {
    const { error } = await supabase.from("document_tracking").insert(row);
    if (error) return { error: "save_failed" };
  }

  if (input.driverProfileId && payload.track_expiry) {
    await supabase
      .from("driver_documents")
      .update({
        expires_at: payload.expires_at,
        updated_at: now,
      })
      .eq("driver_id", input.driverProfileId)
      .eq("doc_type", input.docType);
  }

  return {};
}

export async function deleteDocumentTracking(input: {
  intakeId: string;
  driverProfileId: string | null;
  docType: DriverDocumentType;
}): Promise<void> {
  const supabase = await createClient();
  let query = supabase.from("document_tracking").delete().eq("doc_type", input.docType);

  if (input.driverProfileId) {
    query = query.or(
      `driver_id.eq.${input.driverProfileId},intake_id.eq.${input.intakeId}`,
    );
  } else {
    query = query.eq("intake_id", input.intakeId);
  }

  await query;
}
