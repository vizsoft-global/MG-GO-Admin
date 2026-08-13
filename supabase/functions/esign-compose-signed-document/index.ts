// Composes the signature-stamped copy of an e-sign document.
//
// The driver's device may ask for composition, but never authors the artifact:
// everything below runs with the service role, reads the *original*
// `document_storage_key` (never a previous output), and writes to a
// deterministic key so re-running overwrites rather than double-stamping.
//
// Placement contract (also documented in the migration):
//   - signature stamped on the LAST page, bottom-right
//   - 36pt (0.5") margin from the right and bottom edges
//   - signature scaled to fit 180x60pt, aspect ratio preserved
//   - caption printed under the signature, right-aligned, Helvetica 7.5pt:
//     signer name / "Signed <UTC timestamp>" / request code
//
// Source formats: PDF is stamped in place. PNG and JPEG are wrapped into a
// single-page PDF first. Anything else (WebP, unknown bytes) is REFUSED with
// `unsupported_source_type` and recorded in `esign_requests.signed_document_error`.
// Images are also structurally validated before they reach the decoder — see
// `validatePng` for why the magic bytes alone are not enough.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

const BUCKET = "esign-documents";
const MARGIN = 36;
const SIG_MAX_WIDTH = 180;
const SIG_MAX_HEIGHT = 60;
const CAPTION_SIZE = 7.5;
const CAPTION_LEADING = 9.5;
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Some rows store keys bucket-prefixed (`esign-documents/foo.pdf`). */
function normalizeKey(key: string): string {
  const trimmed = key.trim().replace(/^\/+/, "");
  return trimmed.startsWith(`${BUCKET}/`)
    ? trimmed.slice(BUCKET.length + 1)
    : trimmed;
}

type SourceKind = "pdf" | "png" | "jpeg" | "unsupported";

function sniff(bytes: Uint8Array): SourceKind {
  if (bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46 && bytes[4] === 0x2d
  ) return "pdf";
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) return "png";
  if (bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  ) return "jpeg";
  return "unsupported";
}

// Guard rails for the decoders below. pdf-lib decodes an image in memory, so a bad or
// oversized one takes the whole worker down with WORKER_RESOURCE_LIMIT before `fail()` can
// record anything — the request then looks stuck with no explanation. Admin upload caps at
// 10MB; the extra headroom is for PDFs that grow when re-saved.
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 30_000_000;

const PNG_COLOUR_TYPES = new Set([0, 2, 3, 4, 6]);
const PNG_BIT_DEPTHS = new Set([1, 2, 4, 8, 16]);

/**
 * Walks the PNG chunk table instead of trusting the 8-byte magic. A file that starts with the
 * signature but carries garbage chunks is exactly what killed the worker in QA: the decoder
 * kept allocating on a bogus IDAT length.
 */
function validatePng(bytes: Uint8Array): string | null {
  if (bytes.length < 8 + 25) return "truncated";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (view.getUint32(8) !== 13) return "bad_ihdr_length";
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return "missing_ihdr";

  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return "zero_dimension";
  if (width * height > MAX_IMAGE_PIXELS) return "too_many_pixels";
  if (!PNG_BIT_DEPTHS.has(bytes[24])) return "bad_bit_depth";
  if (!PNG_COLOUR_TYPES.has(bytes[25])) return "bad_colour_type";

  let offset = 8;
  let sawData = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    // A declared length that runs past the file is the corruption we are looking for.
    if (length > bytes.length - offset - 12) return "chunk_overruns_file";
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT") sawData = true;
    if (type === "IEND") return sawData ? null : "no_image_data";
    offset += 12 + length;
  }
  return "missing_iend";
}

/** JPEG only needs a truncation check — pdf-lib is far less fragile with it than with PNG. */
function validateJpeg(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return "truncated";
  const tailStart = Math.max(0, bytes.length - 512);
  for (let i = bytes.length - 2; i >= tailStart; i -= 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return null;
  }
  return "missing_end_of_image";
}

function validateImage(bytes: Uint8Array, kind: SourceKind): string | null {
  if (kind === "png") return validatePng(bytes);
  if (kind === "jpeg") return validateJpeg(bytes);
  return null;
}

/**
 * The platform injects either the legacy `service_role` JWT or an opaque
 * `sb_secret_*` key depending on project vintage, so accept both shapes.
 */
function isServiceRoleBearer(bearer: string, serviceRoleKey: string): boolean {
  if (bearer === serviceRoleKey) return true;
  const parts = bearer.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

function formatSignedAt(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.toISOString().slice(0, 10)} ${
    parsed.toISOString().slice(11, 16)
  } UTC`;
}

async function loadDocument(bytes: Uint8Array, kind: SourceKind) {
  if (kind === "pdf") return await PDFDocument.load(bytes);

  const pdf = await PDFDocument.create();
  const image = kind === "png"
    ? await pdf.embedPng(bytes)
    : await pdf.embedJpg(bytes);
  const scale = Math.min(
    (A4_WIDTH - MARGIN * 2) / image.width,
    (A4_HEIGHT - MARGIN * 2) / image.height,
    1,
  );
  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  page.drawImage(image, {
    x: (A4_WIDTH - drawWidth) / 2,
    y: (A4_HEIGHT - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  });
  return pdf;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  let requestId = "";
  try {
    const body = await req.json();
    requestId = String(body?.request_id ?? "").trim();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }
  if (!requestId) {
    return json({ ok: false, error: "request_id_required" }, 400);
  }

  const bearer = (req.headers.get("Authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  ).trim();
  if (!bearer) {
    return json({ ok: false, error: "not_authenticated" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Service-role callers (admin backfill) skip the ownership check; anyone
  // else must be the driver the request belongs to.
  let callerId: string | null = null;
  if (!isServiceRoleBearer(bearer, serviceRoleKey)) {
    const { data: userData, error: userError } = await admin.auth.getUser(
      bearer,
    );
    if (userError || !userData?.user?.id) {
      return json({ ok: false, error: "not_authenticated" }, 401);
    }
    callerId = userData.user.id;
  }

  const { data: row, error: rowError } = await admin
    .from("esign_requests")
    .select(
      "id, request_code, driver_id, status, document_storage_key, signature_storage_key, signed_document_storage_key, signer_display_name, signed_at",
    )
    .eq("id", requestId)
    .maybeSingle();

  if (rowError) {
    console.error("esign row lookup failed", rowError.message);
    return json({ ok: false, error: "lookup_failed" }, 500);
  }
  if (!row) return json({ ok: false, error: "not_found" }, 404);
  if (callerId && callerId !== row.driver_id) {
    return json({ ok: false, error: "not_authorized" }, 403);
  }
  if (row.status !== "signed") {
    return json({ ok: false, error: "not_signed", status: row.status }, 409);
  }
  if (!row.document_storage_key) {
    return json({ ok: false, error: "no_source_document" }, 422);
  }
  if (!row.signature_storage_key) {
    return json({ ok: false, error: "no_signature" }, 422);
  }

  const outputKey = `signed/${row.id}/${
    row.request_code ?? row.id
  }-signed.pdf`;

  if (row.signed_document_storage_key === outputKey) {
    const { data: existing } = await admin.storage.from(BUCKET).download(
      outputKey,
    );
    if (existing) {
      return json({
        ok: true,
        already_generated: true,
        request_id: row.id,
        storage_key: outputKey,
        bytes: existing.size,
      });
    }
  }

  async function fail(code: string, status: number, extra = {}) {
    await admin
      .from("esign_requests")
      .update({ signed_document_error: code, updated_at: new Date().toISOString() })
      .eq("id", requestId);
    return json({ ok: false, error: code, request_id: requestId, ...extra }, status);
  }

  const [sourceRes, signatureRes] = await Promise.all([
    admin.storage.from(BUCKET).download(normalizeKey(row.document_storage_key)),
    admin.storage.from(BUCKET).download(normalizeKey(row.signature_storage_key)),
  ]);

  if (sourceRes.error || !sourceRes.data) {
    return await fail("source_document_unavailable", 422, {
      detail: sourceRes.error?.message ?? null,
    });
  }
  if (signatureRes.error || !signatureRes.data) {
    return await fail("signature_unavailable", 422, {
      detail: signatureRes.error?.message ?? null,
    });
  }

  const sourceBytes = new Uint8Array(await sourceRes.data.arrayBuffer());
  const signatureBytes = new Uint8Array(await signatureRes.data.arrayBuffer());

  if (sourceBytes.length > MAX_SOURCE_BYTES) {
    return await fail("source_too_large", 422, {
      detail: `${sourceBytes.length} bytes exceeds the ${MAX_SOURCE_BYTES} byte limit.`,
    });
  }
  if (signatureBytes.length > MAX_SIGNATURE_BYTES) {
    return await fail("signature_too_large", 422, {
      detail: `${signatureBytes.length} bytes exceeds the ${MAX_SIGNATURE_BYTES} byte limit.`,
    });
  }

  const sourceKind = sniff(sourceBytes);
  if (sourceKind === "unsupported") {
    return await fail("unsupported_source_type", 422, {
      detail:
        "Only PDF, PNG and JPEG source documents can be composed. WebP and other formats must be re-uploaded as PDF.",
    });
  }
  const signatureKind = sniff(signatureBytes);
  if (signatureKind !== "png" && signatureKind !== "jpeg") {
    return await fail("unsupported_signature_type", 422, {
      detail: "Signature must be PNG or JPEG.",
    });
  }

  // Structure, not just the magic bytes: a corrupt image must fail through `fail()` here
  // rather than inside the decoder, where it takes the worker with it.
  const sourceDefect = validateImage(sourceBytes, sourceKind);
  if (sourceDefect) {
    return await fail("malformed_source_image", 422, { detail: sourceDefect });
  }
  const signatureDefect = validateImage(signatureBytes, signatureKind);
  if (signatureDefect) {
    return await fail("malformed_signature_image", 422, { detail: signatureDefect });
  }

  let pdfBytes: Uint8Array;
  let pageCount = 0;
  try {
    const pdf = await loadDocument(sourceBytes, sourceKind);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const signature = signatureKind === "png"
      ? await pdf.embedPng(signatureBytes)
      : await pdf.embedJpg(signatureBytes);

    const pages = pdf.getPages();
    pageCount = pages.length;
    if (pageCount === 0) {
      return await fail("empty_document", 422);
    }
    const page = pages[pageCount - 1];
    const { width: pageWidth } = page.getSize();

    const captions = [
      row.signer_display_name?.trim() || "Signed by driver",
      formatSignedAt(row.signed_at),
      row.request_code ?? "",
    ].filter((line) => line.length > 0);

    const scale = Math.min(
      SIG_MAX_WIDTH / signature.width,
      SIG_MAX_HEIGHT / signature.height,
      1,
    );
    const sigWidth = signature.width * scale;
    const sigHeight = signature.height * scale;
    const captionBlockHeight = captions.length * CAPTION_LEADING;
    const sigX = Math.max(MARGIN, pageWidth - MARGIN - sigWidth);
    const sigY = MARGIN + captionBlockHeight;

    page.drawImage(signature, {
      x: sigX,
      y: sigY,
      width: sigWidth,
      height: sigHeight,
    });

    captions.forEach((line, index) => {
      const textWidth = font.widthOfTextAtSize(line, CAPTION_SIZE);
      page.drawText(line, {
        x: Math.max(MARGIN, pageWidth - MARGIN - textWidth),
        y: MARGIN + captionBlockHeight - (index + 1) * CAPTION_LEADING,
        size: CAPTION_SIZE,
        font,
        color: rgb(0.25, 0.28, 0.32),
      });
    });

    pdfBytes = await pdf.save();
  } catch (error) {
    console.error("compose failed", error);
    return await fail("compose_failed", 500, {
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const { error: uploadError } = await admin.storage.from(BUCKET).upload(
    outputKey,
    pdfBytes,
    { contentType: "application/pdf", upsert: true },
  );
  if (uploadError) {
    console.error("upload failed", uploadError.message);
    return await fail("upload_failed", 500, { detail: uploadError.message });
  }

  const { error: updateError } = await admin
    .from("esign_requests")
    .update({
      signed_document_storage_key: outputKey,
      signed_document_generated_at: new Date().toISOString(),
      signed_document_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (updateError) {
    console.error("row update failed", updateError.message);
    return json({ ok: false, error: "persist_failed" }, 500);
  }

  return json({
    ok: true,
    already_generated: false,
    request_id: row.id,
    storage_key: outputKey,
    bytes: pdfBytes.length,
    pages: pageCount,
    source_kind: sourceKind,
  });
});
