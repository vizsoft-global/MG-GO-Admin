"use server";

import { refresh, revalidatePath } from "next/cache";
import type { DocumentData } from "firebase-admin/firestore";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  ALLOWED_SPLASH_EXTENSIONS,
  MAX_SPLASH_BYTES,
} from "@/lib/branding/constants";
import { getFirebaseStorage } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  HOME_BANNER_PREFIX,
  type HomeBannerLookups,
  type HomeBannerOption,
  type HomeBannerRow,
} from "./home-banners";

const BANNERS = "driver_home_banners";

function formatError(error: { code?: string | null; message?: string | null } | null | undefined): string | undefined {
  if (!error?.message) return undefined;
  return error.code ? `${error.code} — ${error.message}` : error.message;
}

async function requireSettingsManager() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "settings.manage", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

function parseUuidList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function scheduleValue(raw: string | null): string | null {
  return raw;
}

function brandingObjectPath(relativePath: string): string {
  const trimmed = relativePath.replace(/^\/+/, "");
  return trimmed.startsWith("branding/") ? trimmed : `branding/${trimmed}`;
}

async function saveBrandingObject(
  relativePath: string,
  buffer: Buffer,
  contentType: string,
): Promise<string | null> {
  const storage = await getFirebaseStorage();
  const bucket = storage?.bucket();
  if (!bucket) return null;
  const objectPath = brandingObjectPath(relativePath);
  const token = crypto.randomUUID();
  await bucket.file(objectPath).save(buffer, {
    contentType,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

async function removeBrandingObject(relativePath: string): Promise<void> {
  const storage = await getFirebaseStorage();
  const bucket = storage?.bucket();
  if (!bucket) return;
  await bucket.file(brandingObjectPath(relativePath)).delete({ ignoreNotFound: true });
}

function bannerFromDoc(id: string, data: DocumentData): HomeBannerRow {
  return {
    id,
    image_object_key: text(data.image_object_key) ?? "",
    image_url: text(data.image_url) ?? "",
    caption_en: text(data.caption_en),
    caption_ar: text(data.caption_ar),
    deep_link: text(data.deep_link),
    starts_at: iso(data.starts_at),
    ends_at: iso(data.ends_at),
    is_active: data.is_active === true,
    sort_order: typeof data.sort_order === "number" ? data.sort_order : 0,
    zone_ids: parseUuidList(data.zone_ids),
    partner_ids: parseUuidList(data.partner_ids),
    driver_group_ids: parseUuidList(data.driver_group_ids),
  };
}

function optionFromDoc(id: string, data: DocumentData): HomeBannerOption {
  return { id, name: text(data.name) ?? "" };
}

function byName(a: HomeBannerOption, b: HomeBannerOption): number {
  return a.name.localeCompare(b.name);
}

export async function listHomeBanners(): Promise<{
  banners: HomeBannerRow[];
  lookups: HomeBannerLookups;
  error?: string;
}> {
  const empty = { banners: [], lookups: { zones: [], partners: [], groups: [] } };
  const auth = await requireSettingsManager();
  if ("error" in auth) return { ...empty, error: auth.error };

  const db = await staffDb();
  if (!db) return { ...empty, error: "not_configured" };

  try {
    const [bannersSnap, zonesSnap, partnersSnap, groupsSnap] = await Promise.all([
      db.collection(BANNERS).get(),
      db.collection(COLLECTIONS.zones).get(),
      db.collection(COLLECTIONS.partners).get(),
      db.collection(COLLECTIONS.driverGroups).get(),
    ]);

    const banners = bannersSnap.docs
      .map((doc) => ({ row: bannerFromDoc(doc.id, doc.data()), createdAt: iso(doc.data().created_at) ?? "" }))
      .sort((a, b) => {
        if (a.row.sort_order !== b.row.sort_order) return a.row.sort_order - b.row.sort_order;
        return b.createdAt.localeCompare(a.createdAt);
      })
      .map((entry) => entry.row);

    await logAdminRead("driver_home_banners", "/settings/app");

    return {
      banners,
      lookups: {
        zones: zonesSnap.docs.map((doc) => optionFromDoc(doc.id, doc.data())).sort(byName),
        partners: partnersSnap.docs.map((doc) => optionFromDoc(doc.id, doc.data())).sort(byName),
        groups: groupsSnap.docs.map((doc) => optionFromDoc(doc.id, doc.data())).sort(byName),
      },
    };
  } catch (error) {
    return {
      ...empty,
      error: formatError(error instanceof Error ? { message: error.message } : { message: "fetch_failed" }),
    };
  }
}

export async function saveHomeBanner(
  locale: string,
  formData: FormData,
): Promise<{ error?: string; errorDetail?: string; success?: boolean }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  const id = String(formData.get("id") ?? "").trim() || null;
  const captionEn = String(formData.get("caption_en") ?? "").trim() || null;
  const captionAr = String(formData.get("caption_ar") ?? "").trim() || null;
  const deepLink = String(formData.get("deep_link") ?? "").trim() || null;
  const startsAt = String(formData.get("starts_at") ?? "").trim() || null;
  const endsAt = String(formData.get("ends_at") ?? "").trim() || null;
  const isActive = String(formData.get("is_active") ?? "") === "true";
  const sortOrder = Number.parseInt(String(formData.get("sort_order") ?? "0"), 10);
  const zoneIds = parseUuidList(JSON.parse(String(formData.get("zone_ids") ?? "[]")));
  const partnerIds = parseUuidList(JSON.parse(String(formData.get("partner_ids") ?? "[]")));
  const groupIds = parseUuidList(JSON.parse(String(formData.get("driver_group_ids") ?? "[]")));
  const file = formData.get("image") as File | null;

  if (startsAt && endsAt && endsAt < startsAt) {
    return { error: "invalid_range" };
  }

  const db = await staffDb();
  if (!db) return { error: "save_failed", errorDetail: "not_configured" };

  let imageObjectKey: string | undefined;
  let imageUrl: string | undefined;

  if (file && file.size > 0) {
    if (file.size > MAX_SPLASH_BYTES) return { error: "file_too_large" };
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_SPLASH_EXTENSIONS.includes(ext as (typeof ALLOWED_SPLASH_EXTENSIONS)[number])) {
      return { error: "invalid_type" };
    }
    const mimeByExt: Record<(typeof ALLOWED_SPLASH_EXTENSIONS)[number], string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
    };
    const bannerId = id ?? crypto.randomUUID();
    const path = `${HOME_BANNER_PREFIX}/${bannerId}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    let publicUrl: string | null = null;
    try {
      publicUrl = await saveBrandingObject(
        path,
        buffer,
        mimeByExt[ext as (typeof ALLOWED_SPLASH_EXTENSIONS)[number]],
      );
    } catch (error) {
      return {
        error: "upload_failed",
        errorDetail: formatError(error instanceof Error ? { message: error.message } : undefined),
      };
    }
    if (!publicUrl) return { error: "upload_failed" };
    imageObjectKey = path;
    imageUrl = `${publicUrl}&v=${Date.now()}`;
    if (!id) {
      try {
        await db.collection(BANNERS).doc(bannerId).set({
          id: bannerId,
          image_object_key: imageObjectKey,
          image_url: imageUrl,
          caption_en: captionEn,
          caption_ar: captionAr,
          deep_link: deepLink,
          starts_at: scheduleValue(startsAt),
          ends_at: scheduleValue(endsAt),
          is_active: isActive,
          sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
          zone_ids: zoneIds,
          partner_ids: partnerIds,
          driver_group_ids: groupIds,
          created_by: auth.session.id,
          created_at: new Date(),
        });
      } catch (error) {
        return {
          error: "save_failed",
          errorDetail: formatError(error instanceof Error ? { message: error.message } : undefined),
        };
      }
      await logAdminMutation({
        action: "create",
        entityType: "driver_home_banners",
        entityId: bannerId,
        routeName: "/settings/app",
      });
      revalidatePath(`/${locale}/settings/app`, "page");
      refresh();
      return { success: true };
    }
  }

  if (!id && !imageObjectKey) return { error: "missing_file" };

  const patch = {
    caption_en: captionEn,
    caption_ar: captionAr,
    deep_link: deepLink,
    starts_at: scheduleValue(startsAt),
    ends_at: scheduleValue(endsAt),
    is_active: isActive,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    zone_ids: zoneIds,
    partner_ids: partnerIds,
    driver_group_ids: groupIds,
    updated_at: new Date(),
    ...(imageObjectKey && imageUrl
      ? { image_object_key: imageObjectKey, image_url: imageUrl }
      : {}),
  };

  try {
    await db.collection(BANNERS).doc(id!).set(patch, { merge: true });
  } catch (error) {
    return {
      error: "save_failed",
      errorDetail: formatError(error instanceof Error ? { message: error.message } : undefined),
    };
  }

  await logAdminMutation({
    action: "update",
    entityType: "driver_home_banners",
    entityId: id!,
    routeName: "/settings/app",
  });
  revalidatePath(`/${locale}/settings/app`, "page");
  refresh();
  return { success: true };
}

export async function deleteHomeBanner(
  locale: string,
  id: string,
): Promise<{ error?: string; errorDetail?: string; success?: boolean }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  const db = await staffDb();
  if (!db) return { error: "save_failed", errorDetail: "not_configured" };

  const ref = db.collection(BANNERS).doc(id);
  const existing = await ref.get();
  const key = text(existing.data()?.image_object_key);
  try {
    await ref.delete();
  } catch (error) {
    return {
      error: "save_failed",
      errorDetail: formatError(error instanceof Error ? { message: error.message } : undefined),
    };
  }

  if (key) {
    try {
      await removeBrandingObject(key);
    } catch {
      /* best-effort */
    }
  }

  await logAdminMutation({
    action: "delete",
    entityType: "driver_home_banners",
    entityId: id,
    routeName: "/settings/app",
  });
  revalidatePath(`/${locale}/settings/app`, "page");
  refresh();
  return { success: true };
}
