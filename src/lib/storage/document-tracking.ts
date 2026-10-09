import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import {
  DEFAULT_NOTIFY_LEAD_DAYS,
  type DocumentExpiryConfig,
  type DriverDocumentType,
} from "@/features/drivers/types";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

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

const SCAN_CAP = 200;

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

function asText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

function asLeadDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_NOTIFY_LEAD_DAYS];
  const days = value.filter((item) => typeof item === "number" && Number.isFinite(item));
  return days.length > 0 ? days : [...DEFAULT_NOTIFY_LEAD_DAYS];
}

async function matchingDocs(
  db: Firestore,
  intakeId: string,
  driverProfileId: string | null,
  docType?: DriverDocumentType,
) {
  const col = db.collection(COLLECTIONS.documentTracking);
  const snaps = await Promise.all([
    driverProfileId
      ? col.where("driver_id", "==", driverProfileId).limit(SCAN_CAP).get()
      : Promise.resolve(null),
    col.where("intake_id", "==", intakeId).limit(SCAN_CAP).get(),
  ]);
  const byId = new Map<string, QueryDocumentSnapshot>();
  for (const snap of snaps) {
    if (!snap) continue;
    for (const doc of snap.docs) {
      if (docType && doc.get("doc_type") !== docType) continue;
      byId.set(doc.id, doc);
    }
  }
  return [...byId.values()];
}

export async function listDocumentTracking(
  intakeId: string,
  driverProfileId: string | null,
): Promise<Partial<Record<DriverDocumentType, DocumentExpiryConfig>>> {
  const db = await staffDb();
  const out: Partial<Record<DriverDocumentType, DocumentExpiryConfig>> = {};
  if (!db) return out;

  const docs = await matchingDocs(db, intakeId, driverProfileId);
  const intakeFirst = [
    ...docs.filter((doc) => doc.get("driver_id") !== driverProfileId),
    ...docs.filter((doc) => driverProfileId && doc.get("driver_id") === driverProfileId),
  ];

  for (const doc of intakeFirst) {
    const data = doc.data();
    const docType = data.doc_type as DriverDocumentType;
    out[docType] = {
      trackExpiry: Boolean(data.track_expiry),
      expiresAt: asText(data.expires_at),
      notifyEnabled: Boolean(data.notify_enabled),
      notifyLeadDays: asLeadDays(data.notify_lead_days),
      objectKey: asText(data.object_key),
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
  const db = await staffDb();
  if (!db) return { error: "not_configured" };

  const payload = expiryConfigToPayload(input.expiry);
  const now = new Date();
  const existing = await matchingDocs(db, input.intakeId, input.driverProfileId, input.docType);
  if (existing.length > 1) return { error: "save_failed" };

  const row = {
    intake_id: input.intakeId,
    driver_id: input.driverProfileId,
    doc_type: input.docType,
    object_key: input.objectKey ?? null,
    updated_at: now,
    ...payload,
  };

  try {
    if (existing[0]) {
      await existing[0].ref.update(row);
    } else {
      const ref = db.collection(COLLECTIONS.documentTracking).doc();
      await ref.set({ id: ref.id, ...row });
    }
  } catch {
    return { error: "save_failed" };
  }

  if (input.driverProfileId && payload.track_expiry) {
    const docs = await db
      .collection(COLLECTIONS.driverDocuments)
      .where("driver_id", "==", input.driverProfileId)
      .limit(SCAN_CAP)
      .get();
    const batch = db.batch();
    let writes = 0;
    for (const doc of docs.docs) {
      if (doc.get("doc_type") !== input.docType) continue;
      batch.update(doc.ref, { expires_at: payload.expires_at, updated_at: now });
      writes += 1;
    }
    if (writes > 0) await batch.commit();
  }

  return {};
}

export async function deleteDocumentTracking(input: {
  intakeId: string;
  driverProfileId: string | null;
  docType: DriverDocumentType;
}): Promise<void> {
  const db = await staffDb();
  if (!db) return;

  const docs = await matchingDocs(db, input.intakeId, input.driverProfileId, input.docType);
  for (let index = 0; index < docs.length; index += 400) {
    const batch = db.batch();
    for (const doc of docs.slice(index, index + 400)) batch.delete(doc.ref);
    await batch.commit();
  }
}
