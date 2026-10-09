"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  allPartnerLogoKeys,
  buildPartnerLogoKey,
} from "@/lib/storage/r2-keys";
import { deleteObjects, putObject } from "@/lib/storage/r2-client";
import { resolvePartnerLogoUrls } from "@/lib/storage/partner-logo-url";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { slugifyPartnerName } from "./partner-slug";
import { mapPartnerDbError } from "./partner-errors";
import { resolvePartnerLogoMeta } from "./partner-logo";
import type { PartnerRow } from "./types";

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

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function requirePartnersManager(verb: "create" | "edit" | "delete" = "edit") {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, `partners.${verb}` as Permission, session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export type PartnerMutationResult = {
  error?: string;
  success?: boolean;
  id?: string;
  logoUrl?: string;
  logoWarning?: string;
};

async function uniquePartnerSlug(
  db: Firestore,
  baseSlug: string,
  excludeId?: string,
): Promise<string> {
  let candidate = baseSlug;
  let n = 2;
  while (true) {
    const snap = await db.collection(COLLECTIONS.partners).where("slug", "==", candidate).limit(1).get();
    const hit = snap.docs[0];
    if (!hit || (excludeId && hit.id === excludeId)) return candidate;
    candidate = `${baseSlug}-${n}`;
    n += 1;
  }
}

async function uploadPartnerLogoFile(
  partnerId: string,
  file: File,
  uploadedBy: string,
): Promise<{ error?: string; logoUrl?: string }> {
  if (file.size === 0) return {};

  const meta = resolvePartnerLogoMeta(file);
  if (meta.error) return { error: meta.error };
  const { ext, contentType } = meta;
  if (!ext || !contentType) return { error: "invalid_type" };

  const key = buildPartnerLogoKey(partnerId, ext);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await putObject(key, buffer, contentType, {
      uploadedBy,
      entityType: "partner_logo",
      entityId: partnerId,
      uploadedVia: "admin",
    });
  } catch {
    return { error: "upload_failed" };
  }

  return { logoUrl: key };
}

/** Id+name for filters. Any panel user; does not require partners.view. */
export async function loadPartnerSelectOptions(): Promise<Array<{ id: string; name: string }>> {
  const session = await getSessionUser();
  if (!session) throw new Error("not_authorized");
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.partners).select("name").get();
  return snap.docs
    .map((doc) => ({ id: doc.id, name: str(doc.data().name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchPartnersForAdmin(): Promise<PartnerRow[]> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "partners.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }

  void logAdminRead("partners", "fetchPartnersForAdmin");
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.partners).get();
  const partners = snap.docs
    .map((doc) => asRow(doc.id, doc.data()))
    .sort((a, b) => str(a.name).localeCompare(str(b.name)));

  const driverCounts = new Map<string, number>();
  if (partners.length > 0) {
    const drivers = await db.collection(COLLECTIONS.drivers).select("partner_id").get();
    for (const doc of drivers.docs) {
      const partnerId = str(doc.data().partner_id);
      if (!partnerId) continue;
      driverCounts.set(partnerId, (driverCounts.get(partnerId) ?? 0) + 1);
    }
  }

  const rows = partners.map((partner) => ({
    id: partner.id,
    name: str(partner.name),
    slug: str(partner.slug),
    description: str(partner.description) || null,
    logo_url: str(partner.logo_url) || null,
    created_at: str(partner.created_at),
    updated_at: str(partner.updated_at),
    driver_count: driverCounts.get(partner.id) ?? 0,
  }));

  const withUrls = await resolvePartnerLogoUrls(rows);
  return withUrls.map(({ logo_display_url, ...partner }) => ({
    ...partner,
    logo_url: logo_display_url,
  }));
}

export async function createPartner(formData: FormData): Promise<PartnerMutationResult> {
  const auth = await requirePartnersManager("create");
  if ("error" in auth) return auth;

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const logoFile = formData.get("logo");
  if (!name) return { error: "missing_fields" };

  const db = await openDb();
  const slug = await uniquePartnerSlug(db, slugifyPartnerName(name));
  const id = crypto.randomUUID();

  try {
    await db.collection(COLLECTIONS.partners).doc(id).set({
      id,
      name,
      slug,
      description: description || null,
      created_at: new Date(),
      updated_at: new Date(),
    });
  } catch (error) {
    return { error: mapPartnerDbError(error as { message?: string }) };
  }

  let logoUrl: string | undefined;
  let logoWarning: string | undefined;
  if (logoFile instanceof File && logoFile.size > 0) {
    const upload = await uploadPartnerLogoFile(id, logoFile, auth.session.id);
    if (upload.error) {
      logoWarning = upload.error;
    } else {
      logoUrl = upload.logoUrl;
      if (logoUrl) {
        await db.collection(COLLECTIONS.partners).doc(id).set(
          { logo_url: logoUrl, updated_at: new Date() },
          { merge: true },
        );
      }
    }
  }

  void logAdminMutation({
    action: "create",
    entityType: "partner",
    entityId: id,
    routeName: "createPartner",
    after: { name, slug },
  });

  return { success: true, id, logoUrl, logoWarning };
}

export async function updatePartner(formData: FormData): Promise<PartnerMutationResult> {
  const auth = await requirePartnersManager("edit");
  if ("error" in auth) return auth;

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const logoFile = formData.get("logo");
  const removeLogo = formData.get("removeLogo") === "true";
  if (!id || !name) return { error: "missing_fields" };

  const db = await openDb();
  const slug = await uniquePartnerSlug(db, slugifyPartnerName(name), id);

  let logoUrl: string | null | undefined;
  let logoWarning: string | undefined;
  if (removeLogo) {
    logoUrl = null;
    try {
      await deleteObjects(allPartnerLogoKeys(id));
    } catch {
      /* best-effort */
    }
  } else if (logoFile instanceof File && logoFile.size > 0) {
    try {
      await deleteObjects(allPartnerLogoKeys(id));
    } catch {
      /* best-effort */
    }
    const upload = await uploadPartnerLogoFile(id, logoFile, auth.session.id);
    if (upload.error) {
      logoWarning = upload.error;
    } else {
      logoUrl = upload.logoUrl ?? null;
    }
  }

  const patch: {
    name: string;
    slug: string;
    description: string | null;
    updated_at: Date;
    logo_url?: string | null;
  } = {
    name,
    slug,
    description: description || null,
    updated_at: new Date(),
  };
  if (logoUrl !== undefined) patch.logo_url = logoUrl;

  try {
    await db.collection(COLLECTIONS.partners).doc(id).set(patch, { merge: true });
  } catch (error) {
    return { error: mapPartnerDbError(error as { message?: string }) };
  }

  void logAdminMutation({
    action: "update",
    entityType: "partner",
    entityId: id,
    routeName: "updatePartner",
    after: { name, slug },
  });

  return { success: true, id, logoUrl: logoUrl ?? undefined, logoWarning };
}

export async function deletePartner(id: string): Promise<PartnerMutationResult> {
  const auth = await requirePartnersManager("delete");
  if ("error" in auth) return auth;

  const db = await openDb();
  const driverCount = await db.collection(COLLECTIONS.drivers).where("partner_id", "==", id).count().get();
  if (driverCount.data().count > 0) return { error: "has_drivers" };

  const restaurantCount = await db
    .collection(COLLECTIONS.restaurants)
    .where("partner_id", "==", id)
    .count()
    .get();
  if (restaurantCount.data().count > 0) return { error: "has_restaurants" };

  try {
    await db.collection(COLLECTIONS.partners).doc(id).delete();
  } catch (error) {
    return { error: mapPartnerDbError(error as { message?: string }) };
  }

  try {
    await deleteObjects(allPartnerLogoKeys(id));
  } catch {
    /* best-effort */
  }

  void logAdminMutation({
    action: "delete",
    entityType: "partner",
    entityId: id,
    routeName: "deletePartner",
  });

  return { success: true };
}
