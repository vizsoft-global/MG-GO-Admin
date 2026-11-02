"use server";

import { revalidatePath } from "next/cache";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import * as reads from "./service-reads";
import {
  categoryForServiceType,
  isServiceCategoryKey,
  SERVICE_TYPE_KEY_RE,
  serviceTypeKey,
  type ServiceCategoryKey,
} from "./service-types";
import type { ServiceTypeImportItem } from "./service-type-import";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function openDb() {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

async function requireServiceManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "service.manage", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

/** Client-facing wrapper: a `"use server"` module may only export async functions. */
export async function listServiceTypeUsage(): Promise<Record<string, number>> {
  return reads.listServiceTypeUsage();
}

export async function upsertServiceType(input: {
  key: string;
  labelEn: string;
  labelAr: string;
  category: string;
  isActive: boolean;
  sortOrder: number;
}): Promise<{ ok: true } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireServiceManage();
  if ("error" in auth) return { error: "not_authorized" };

  const key = (input.key || serviceTypeKey(input.labelEn)).trim().toLowerCase();
  const labelEn = input.labelEn.trim();
  const labelAr = input.labelAr.trim();
  if (!SERVICE_TYPE_KEY_RE.test(key)) return { error: "invalid_key" };
  if (!labelEn) return { error: "missing_fields" };
  const category: ServiceCategoryKey = isServiceCategoryKey(input.category)
    ? input.category
    : categoryForServiceType(labelEn);
  const sortOrder = Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder) : 100;

  const db = await openDb();
  const ref = db.collection(COLLECTIONS.serviceTypes).doc(key);
  const snap = await ref.get();
  const existed = snap.exists;
  const payload = {
    id: key,
    key,
    label_en: labelEn,
    label_ar: labelAr,
    category,
    is_active: input.isActive,
    sort_order: sortOrder,
    updated_at: new Date(),
  };
  try {
    await ref.set(
      existed ? payload : { ...payload, created_at: new Date(), created_by: auth.session.id },
      { merge: true },
    );
  } catch {
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: existed ? "update" : "create",
    entityType: "service_type",
    entityId: key,
    routeName: "/settings/service-types",
    before: existed
      ? {
          label_en: str(snap.get("label_en")),
          label_ar: str(snap.get("label_ar")),
          category: str(snap.get("category")),
          is_active: snap.get("is_active") !== false,
        }
      : null,
    after: { label_en: labelEn, label_ar: labelAr, category, is_active: input.isActive },
  });
  revalidatePath("/settings/service-types");
  revalidatePath("/fleet/service");
  return { ok: true };
}

/** Write cap for one import. Module-local: a `"use server"` file may only export async functions. */
const SERVICE_TYPE_IMPORT_WRITE_CAP = 1000;

/**
 * Writes the previewed rows. Only Create/Update items are sent — a Duplicate was
 * already reported with its sheet row and must never overwrite the first row
 * that claimed the name.
 */
export async function importServiceTypes(
  items: ServiceTypeImportItem[],
): Promise<
  { ok: true; created: number; updated: number; skipped: number } | { error: string }
> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireServiceManage();
  if ("error" in auth) return { error: "not_authorized" };

  const writable = items
    .filter((item) => item.status === "create" || item.status === "update")
    .slice(0, SERVICE_TYPE_IMPORT_WRITE_CAP);
  if (writable.length === 0) return { ok: true, created: 0, updated: 0, skipped: 0 };

  const db = await openDb();
  const now = new Date();
  let created = 0;
  let updated = 0;
  try {
    for (let i = 0; i < writable.length; i += 400) {
      const batch = db.batch();
      for (const item of writable.slice(i, i + 400)) {
        const key = SERVICE_TYPE_KEY_RE.test(item.key) ? item.key : serviceTypeKey(item.labelEn);
        const ref = db.collection(COLLECTIONS.serviceTypes).doc(key);
        const category: ServiceCategoryKey = isServiceCategoryKey(item.category)
          ? item.category
          : categoryForServiceType(item.labelEn);
        const payload: Record<string, unknown> = {
          id: key,
          key,
          label_en: item.labelEn,
          label_ar: item.labelAr,
          category,
          is_active: item.active,
          sort_order: 100,
          updated_at: now,
        };
        if (item.status === "create") {
          payload.created_at = now;
          payload.created_by = auth.session.id;
          created += 1;
        } else {
          updated += 1;
        }
        batch.set(ref, payload, { merge: true });
      }
      await batch.commit();
    }
  } catch {
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "create",
    entityType: "service_type_import",
    entityId: `import_${now.toISOString()}`,
    routeName: "/settings/service-types",
    after: { created, updated, skipped: items.length - writable.length },
  });
  revalidatePath("/settings/service-types");
  revalidatePath("/fleet/service");
  return { ok: true, created, updated, skipped: items.length - writable.length };
}

/** Read-only totals the catalog page prints above the table. */
export async function countServiceTypes(): Promise<{ total: number; active: number }> {
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.serviceTypes).get();
  let active = 0;
  for (const doc of snap.docs) {
    if (doc.get("is_active") !== false) active += 1;
  }
  return { total: snap.size, active };
}
