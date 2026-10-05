import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const supabase = await createClient();
  const [{ data: batch, error: batchError }, { data: rows, error: rowsError }] = await Promise.all([
    (supabase as any).from("esign_batches").select("batch_code, title").eq("id", id).maybeSingle(),
    (supabase as any)
      .from("esign_batch_rows")
      .select(
        `
        row_index,
        employee_id,
        status,
        esign_requests (
          request_code,
          status,
          signed_document_storage_key,
          drivers ( profiles!drivers_id_fkey ( full_name ) )
        )
      `,
      )
      .eq("batch_id", id)
      .order("row_index", { ascending: true }),
  ]);

  if (batchError || rowsError) {
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
  if (!batch) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const inputs: EsignZipRowInput[] = [];
  for (const raw of (rows ?? []) as Record<string, unknown>[]) {
    // A `left` join, because a row that never produced a document has no
    // `esign_requests` to read — and it is exactly those rows the archive
    // drops, so reading it defensively here is what keeps them droppable
    // rather than crashing the whole download.
    const linked = asRecord(raw.esign_requests);
    const drivers = asRecord(linked.drivers);
    const profiles = asRecord(drivers.profiles);
    inputs.push({
      row_index: Number(raw.row_index ?? 0),
      employee_id: raw.employee_id != null ? String(raw.employee_id) : null,
      request_code: linked.request_code != null ? String(linked.request_code) : null,
      driver_name: profiles.full_name != null ? String(profiles.full_name) : null,
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

  const admin = createAdminClient();
  const entries: ZipEntry[] = [];
  let total = 0;
  for (const item of plan) {
    const key = normalizeEsignStorageKey(item.storage_key);
    const downloaded = await admin.storage.from(ESIGN_BUCKET).download(key);
    // One unreadable document fails the archive rather than being skipped: an
    // operator filing a batch needs to know a document is missing, and a
    // quietly smaller archive is the failure mode this route exists to avoid.
    if (downloaded.error || !downloaded.data) {
      return NextResponse.json({ error: "read_failed", storage_key: item.storage_key }, { status: 500 });
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
