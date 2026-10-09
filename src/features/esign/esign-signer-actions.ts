"use server";

import { hasPermissionInSet } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/get-session";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getFirebaseStorage } from "@/lib/firebase/admin";
import { callAdminFunction } from "@/lib/firebase/callable";
import { isEsignStaffSignerRole } from "./esign-signers";
import type {
  EsignCounterSignatureState,
  EsignMySignatureRow,
  EsignRequestStatus,
  EsignSignerOption,
  EsignSignerRow,
  EsignStaffSignerRole,
} from "./types";

const ESIGN_BUCKET = "esign-documents";

async function uploadEsignObject(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<{ error: string | null }> {
  const storage = await getFirebaseStorage();
  if (!storage) return { error: "not_configured" };
  try {
    const file = storage.bucket().file(`${ESIGN_BUCKET}/${key}`);
    const [exists] = await file.exists();
    if (exists) return { error: "already_exists" };
    await file.save(bytes, { contentType, resumable: false });
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "upload_failed" };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function requireEsignManage() {
  const session = await getSessionUser();
  if (
    !session ||
    (!hasPermissionInSet(session.permissions, "requests.manage", session.isSuperAdmin) &&
      !hasPermissionInSet(session.permissions, "employeedesk.manage", session.isSuperAdmin))
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireEsignSign() {
  const session = await getSessionUser();
  if (
    !session ||
    (!hasPermissionInSet(session.permissions, "esign.sign", session.isSuperAdmin) &&
      !hasPermissionInSet(session.permissions, "requests.manage", session.isSuperAdmin) &&
      !hasPermissionInSet(session.permissions, "employeedesk.manage", session.isSuperAdmin))
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

function mapSigner(r: Record<string, unknown>): EsignSignerRow {
  return {
    id: String(r.id),
    request_id: String(r.request_id ?? ""),
    role: String(r.role ?? "signer"),
    sort_order: Number(r.sort_order ?? 0),
    status: String(r.status ?? "pending"),
    driver_id: r.driver_id != null ? String(r.driver_id) : null,
    staff_user_id: r.staff_user_id != null ? String(r.staff_user_id) : null,
    display_name: r.display_name != null ? String(r.display_name) : null,
    employee_id: r.employee_id != null ? String(r.employee_id) : null,
    driver_code: r.driver_code != null ? String(r.driver_code) : null,
    staff_contact: r.staff_contact != null ? String(r.staff_contact) : null,
    is_staff_signer: Boolean(r.is_staff_signer),
    viewed_at: r.viewed_at != null ? String(r.viewed_at) : null,
    signed_at: r.signed_at != null ? String(r.signed_at) : null,
    declined_at: r.declined_at != null ? String(r.declined_at) : null,
    declined_reason: r.declined_reason != null ? String(r.declined_reason) : null,
    created_at: String(r.created_at ?? ""),
  };
}

export async function fetchEsignSigners(requestId: string): Promise<{
  ok: boolean;
  rows: EsignSignerRow[];
  awaiting_counter_signature: boolean;
  counter_signature_state: EsignCounterSignatureState;
  error?: string;
}> {
  await requireEsignManage();
  const { data, error } = await callAdminFunction("admin_list_esign_signers", {
    p_request_id: requestId,
  });
  if (error) {
    return {
      ok: false,
      rows: [],
      awaiting_counter_signature: false,
      counter_signature_state: "none",
      error: error.message,
    };
  }
  const payload = asRecord(data);
  if (payload.ok === false) {
    return {
      ok: false,
      rows: [],
      awaiting_counter_signature: false,
      counter_signature_state: "none",
      error: String(payload.error ?? "failed"),
    };
  }
  const raw = Array.isArray(payload.rows) ? payload.rows : [];
  return {
    ok: true,
    rows: raw.map((row) => mapSigner(asRecord(row))),
    awaiting_counter_signature: Boolean(payload.awaiting_counter_signature),
    counter_signature_state: (["none", "pending", "signed", "declined"].includes(
      String(payload.counter_signature_state),
    )
      ? String(payload.counter_signature_state)
      : "none") as EsignCounterSignatureState,
  };
}

export async function fetchEsignSignerOptions(): Promise<{
  rows: EsignSignerOption[];
  error?: string;
}> {
  await requireEsignManage();
  const { data, error } = await callAdminFunction("admin_esign_signer_options");
  if (error) return { rows: [], error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { rows: [], error: String(payload.error ?? "failed") };
  const raw = Array.isArray(payload.rows) ? payload.rows : [];
  return {
    rows: raw.map((row) => {
      const r = asRecord(row);
      return {
        id: String(r.id),
        full_name: r.full_name != null ? String(r.full_name) : null,
        email: r.email != null ? String(r.email) : null,
        phone: r.phone != null ? String(r.phone) : null,
      };
    }),
  };
}

export async function addEsignSigner(input: {
  request_id: string;
  staff_user_id: string;
  role?: EsignStaffSignerRole;
  display_name?: string | null;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireEsignManage();
  const role = input.role ?? "countersigner";
  if (!isEsignStaffSignerRole(role)) return { ok: false, error: "invalid_role" };
  const { data, error } = await callAdminFunction("admin_add_esign_signer", {
    p_request_id: input.request_id,
    p_staff_user_id: input.staff_user_id,
    p_role: role,
    p_display_name: input.display_name ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "failed") };
  await logAdminMutation({
    action: "create",
    entityType: "esign_request_signers",
    entityId: String(payload.id ?? ""),
    routeName: "esign.signers.add",
    after: { request_id: input.request_id, role },
  });
  return { ok: true, id: payload.id != null ? String(payload.id) : undefined };
}

export async function removeEsignSigner(
  signerId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireEsignManage();
  const { data, error } = await callAdminFunction("admin_remove_esign_signer", {
    p_signer_id: signerId,
  });
  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "failed") };
  await logAdminMutation({
    action: "delete",
    entityType: "esign_request_signers",
    entityId: signerId,
    routeName: "esign.signers.remove",
  });
  return { ok: true };
}

export async function fetchMyEsignSignatures(readyOnly = true): Promise<{
  rows: EsignMySignatureRow[];
  error?: string;
}> {
  await requireEsignSign();
  const { data, error } = await callAdminFunction("admin_list_my_esign_signatures", {
    p_ready_only: readyOnly,
  });
  if (error) return { rows: [], error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { rows: [], error: String(payload.error ?? "failed") };
  const raw = Array.isArray(payload.rows) ? payload.rows : [];
  return {
    rows: raw.map((row) => {
      const r = asRecord(row);
      return {
        signer_id: String(r.signer_id),
        request_id: String(r.request_id),
        role: String(r.role ?? "countersigner"),
        signer_status: String(r.signer_status ?? "pending"),
        assigned_at: String(r.assigned_at ?? ""),
        request_code: String(r.request_code ?? ""),
        title: String(r.title ?? ""),
        request_status: String(r.request_status ?? "pending") as EsignRequestStatus,
        created_at: String(r.created_at ?? ""),
        signed_at: r.signed_at != null ? String(r.signed_at) : null,
        due_at: r.due_at != null ? String(r.due_at) : null,
        category_key: r.category_key != null ? String(r.category_key) : null,
        category_label: r.category_label != null ? String(r.category_label) : null,
        driver_id: r.driver_id != null ? String(r.driver_id) : null,
        driver_name: r.driver_name != null ? String(r.driver_name) : null,
        driver_code: r.driver_code != null ? String(r.driver_code) : null,
        screenshot_restricted: Boolean(r.screenshot_restricted),
        ready: Boolean(r.ready),
        declined_reason: r.declined_reason != null ? String(r.declined_reason) : null,
      };
    }),
  };
}

export async function uploadStaffEsignSignature(
  pngBase64: string,
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  await requireEsignSign();
  const raw = pngBase64.includes(",") ? pngBase64.split(",")[1] ?? "" : pngBase64;
  if (!raw) return { ok: false, error: "empty_signature" };
  const key = `admin/sign/${crypto.randomUUID()}.png`;
  const uploaded = await uploadEsignObject(key, Buffer.from(raw, "base64"), "image/png");
  if (uploaded.error) return { ok: false, error: uploaded.error };
  return { ok: true, key };
}

export async function submitMyEsignSignature(input: {
  request_id: string;
  signature_storage_key: string;
}): Promise<{ ok: boolean; counter_signature_state?: EsignCounterSignatureState; error?: string }> {
  await requireEsignSign();
  const { data, error } = await callAdminFunction("admin_submit_esign_signature", {
    p_request_id: input.request_id,
    p_signature_storage_key: input.signature_storage_key,
    p_signer_meta: {},
  });
  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "failed") };
  return {
    ok: true,
    counter_signature_state: String(
      payload.counter_signature_state ?? "signed",
    ) as EsignCounterSignatureState,
  };
}

export async function declineMyEsignSignature(input: {
  request_id: string;
  reason?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  await requireEsignSign();
  const { data, error } = await callAdminFunction("admin_decline_esign_signature", {
    p_request_id: input.request_id,
    p_reason: input.reason ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "failed") };
  return { ok: true };
}
