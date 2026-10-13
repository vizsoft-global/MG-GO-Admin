import { NextResponse } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { getFirebaseStorage } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { contentDispositionAttachment } from "@/lib/storage/order-proof-url";
import { ESIGN_BUCKET, normalizeEsignStorageKey } from "@/features/esign/esign-storage-key";
import {
  esignArchiveFilename,
  planEsignZipEntries,
  type EsignZipRowInput,
} from "@/features/esign/esign-batch-zip";
import { buildZipStore, type ZipEntry } from "@/features/esign/zip-store";

/**
 * Every signed document in one batch, as a single archive.
 *
 * This exists because the batch's purpose is a *set* of documents — a month of
 * contracts, one signed page per rider — and the per-document endpoint makes
 * the operator click `N` times and then hold `N` files in their downloads
 * folder with no indication of which belongs to whom. The archive carries the
 * naming instead (see `esign-batch-zip.ts`).
 *
 * It is a route rather than a server action because a server action cannot
 * stream a binary response; `document-download` is a route for the same reason.
 *
 * **Caps, and why they are refusals rather than truncations.** A silently short
 * archive is the same class of failure as a silently short report: the operator
 * believes they have everything. So a batch over the document cap or over the
 * byte cap is refused with a code the UI can turn into a sentence, and the UI
 * offers the per-document download instead.
 *
 * **What is *not* archived.** A row whose rider has not signed, or whose row
 * never produced a document, contributes nothing — `planEsignZipEntries` drops
 * it. The archive is "what has been signed", not "what was attempted", and a
 * zero-byte placeholder for an unsigned rider would read as a corrupt file.
 */

/** 500 signed PDFs is ~250 MB of paperwork; beyond that the operator wants a subset. */
const MAX_ENTRIES = 500;
/** A hard ceiling on buffered bytes, so one request cannot exhaust the function. */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

type DocRow = Record<string, unknown> & { id: string };

function cell(value: unknown): unknown {
  if (value == null) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (Array.isArray(value)) return value.map(cell);
  return value;
}

function docRow(id: string, data: DocumentData | undefined): DocRow | null {
  if (!data) return null;
  const row: DocRow = { id };
  for (const [key, value] of Object.entries(data)) row[key] = cell(value);
  return row;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

async function downloadEsignObject(key: string): Promise<Uint8Array | null> {
  const storage = await getFirebaseStorage();
  if (!storage) return null;
  try {
    const file = storage.bucket().file(`${ESIGN_BUCKET}/${key}`);
    const [buf] = await file.download();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "requests.manage", session.isSuperAdmin)
  ) {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const db = await staffDb();
  if (!db) return NextResponse.json({ error: "read_failed" }, { status: 500 });

  let batch: DocRow | null = null;
  let rows: DocRow[] = [];
  try {
    const [batchSnap, rowSnap] = await Promise.all([
      db.collection(COLLECTIONS.esignBatches).doc(id).get(),
      db.collection(COLLECTIONS.esignBatchRows).where("batch_id", "==", id).get(),
    ]);
    batch = batchSnap.exists ? docRow(batchSnap.id, batchSnap.data()) : null;
    rows = rowSnap.docs
      .map((doc) => docRow(doc.id, doc.data())!)
      .sort((left, right) => compareValues(left.row_index, right.row_index));
  } catch {
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
  if (!batch) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const requestIds = rows
    .map((row) => (row.esign_request_id != null ? String(row.esign_request_id) : ""))
    .filter((requestId) => requestId.length > 0);
  const requestById = new Map<string, DocRow>();
  const profileById = new Map<string, DocRow>();
  try {
    for (let i = 0; i < requestIds.length; i += 30) {
      const chunk = [...new Set(requestIds.slice(i, i + 30))];
      const snaps = await db.getAll(
        ...chunk.map((requestId) => db.collection(COLLECTIONS.esignRequests).doc(requestId)),
      );
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const row = docRow(snap.id, snap.data());
        if (row) requestById.set(row.id, row);
      }
    }
    const driverIds = [...requestById.values()]
      .map((row) => (row.driver_id != null ? String(row.driver_id) : ""))
      .filter((driverId) => driverId.length > 0);
    for (let i = 0; i < driverIds.length; i += 30) {
      const chunk = [...new Set(driverIds.slice(i, i + 30))];
      const snaps = await db.getAll(
        ...chunk.map((driverId) => db.collection(COLLECTIONS.profiles).doc(driverId)),
      );
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const row = docRow(snap.id, snap.data());
        if (row) profileById.set(row.id, row);
      }
    }
  } catch {
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }

  const inputs: EsignZipRowInput[] = [];
  for (const raw of rows) {
    const linked = requestById.get(String(raw.esign_request_id ?? "")) ?? { id: "" };
    const driverId = linked.driver_id != null ? String(linked.driver_id) : "";
    const profile = profileById.get(driverId);
    inputs.push({
      row_index: Number(raw.row_index ?? 0),
      employee_id: raw.employee_id != null ? String(raw.employee_id) : null,
      request_code: linked.request_code != null ? String(linked.request_code) : null,
      driver_name: profile?.full_name != null ? String(profile.full_name) : null,
      signed_key:
        linked.signed_document_storage_key != null
          ? String(linked.signed_document_storage_key)
          : null,
    });
  }

  const plan = planEsignZipEntries(inputs);
  if (plan.length === 0) {
    return NextResponse.json({ error: "nothing_signed" }, { status: 404 });
  }
  if (plan.length > MAX_ENTRIES) {
    return NextResponse.json({ error: "too_many_documents" }, { status: 413 });
  }

  const entries: ZipEntry[] = [];
  let total = 0;
  for (const item of plan) {
    const key = normalizeEsignStorageKey(item.storage_key);
    const bytes = await downloadEsignObject(key);
    if (!bytes) {
      return NextResponse.json({ error: "read_failed", storage_key: item.storage_key }, { status: 500 });
    }
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) {
      return NextResponse.json({ error: "archive_too_large" }, { status: 413 });
    }
    entries.push({ name: item.name, bytes });
  }

  const archive = buildZipStore(entries);
  const filename = esignArchiveFilename(
    batch.batch_code != null ? String(batch.batch_code) : null,
    batch.title != null ? String(batch.title) : null,
  );
  return new NextResponse(Buffer.from(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDispositionAttachment(filename),
      "Cache-Control": "private, no-store",
    },
  });
}
