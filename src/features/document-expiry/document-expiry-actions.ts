"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { getPresignedGetUrl } from "@/lib/storage/r2-client";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import type { DocumentExpiryRow, DocumentExpirySummary } from "./document-expiry-utils";
import { bucketDocumentExpiryRow, kuwaitToday } from "./document-expiry-utils";

type Row = Record<string, unknown> & { id: string };

function plainValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if ("toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(plainValue);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = plainValue(child);
  }
  return out;
}

function asRow(id: string, data: DocumentData | undefined): Row {
  return { id, ...((plainValue(data ?? {}) as Record<string, unknown>) ?? {}) };
}

async function openDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

async function rowsByIds(db: Firestore, collection: string, ids: string[]): Promise<Row[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: Row[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map((id) => db.collection(collection).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) out.push(asRow(snap.id, snap.data()));
    }
  }
  return out;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function dateText(value: unknown): string {
  const text = str(value);
  return text.length >= 10 ? text.slice(0, 10) : text;
}

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

  let db: Firestore;
  try {
    db = await openDb();
  } catch {
    return { rows: [], summary: emptySummary(), error: "save_failed" };
  }

  const trackingSnap = await db
    .collection(COLLECTIONS.documentTracking)
    .where("track_expiry", "==", true)
    .get();

  const trackingRows = trackingSnap.docs
    .map((doc) => asRow(doc.id, doc.data()))
    .filter((row) => row.expires_at != null)
    .sort((a, b) => dateText(a.expires_at).localeCompare(dateText(b.expires_at)));

  const driverIds = [
    ...new Set(trackingRows.map((row) => str(row.driver_id)).filter(Boolean)),
  ];
  const intakeIds = [
    ...new Set(trackingRows.map((row) => str(row.intake_id)).filter(Boolean)),
  ];

  const [drivers, profiles, intakes] = await Promise.all([
    rowsByIds(db, COLLECTIONS.drivers, driverIds),
    rowsByIds(db, COLLECTIONS.profiles, driverIds),
    rowsByIds(db, COLLECTIONS.driverIntakes, intakeIds),
  ]);

  const driverMap = new Map(drivers.map((row) => [row.id, row]));
  const profileMap = new Map(profiles.map((row) => [row.id, row]));
  const intakeMap = new Map(intakes.map((row) => [row.id, row]));
  const today = kuwaitToday();

  const rows: DocumentExpiryRow[] = [];
  for (const row of trackingRows) {
    const expiresAt = dateText(row.expires_at);
    const bucket = bucketDocumentExpiryRow(expiresAt, today);
    if (!bucket) continue;

    const driverId = str(row.driver_id);
    const intakeIdRaw = str(row.intake_id);
    const driver = driverId ? driverMap.get(driverId) : undefined;
    const profile = driverId ? profileMap.get(driverId) : undefined;
    const intake = intakeIdRaw ? intakeMap.get(intakeIdRaw) : undefined;
    const driverName = str(profile?.full_name) || str(intake?.full_name) || "—";
    const driverCode = str(driver?.driver_code) || str(intake?.driver_code) || "—";
    const phone = str(profile?.phone) || str(intake?.phone) || null;
    const detailDriverId = driverId || str(intake?.linked_profile_id) || null;
    const intakeId = intakeIdRaw || intake?.id || null;

    if (driver?.archived_at || intake?.archived_at) continue;

    const daysUntil = Math.round(
      (new Date(`${expiresAt}T00:00:00`).getTime() -
        new Date(`${today}T00:00:00`).getTime()) /
        86_400_000,
    );

    rows.push({
      id: row.id,
      bucket,
      docType: str(row.doc_type) as DocumentExpiryRow["docType"],
      expiresAt,
      daysUntil,
      driverId: detailDriverId,
      intakeId,
      driverName,
      driverCode,
      phone,
      objectKey: str(row.object_key) || null,
      notifyEnabled: row.notify_enabled === true,
      notifyLeadDays: Array.isArray(row.notify_lead_days)
        ? (row.notify_lead_days as number[])
        : [],
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
