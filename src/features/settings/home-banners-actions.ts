"use server";

import { refresh, revalidatePath } from "next/cache";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  ALLOWED_SPLASH_EXTENSIONS,
  MAX_SPLASH_BYTES,
} from "@/lib/branding/constants";
import {
  HOME_BANNER_PREFIX,
  type HomeBannerLookups,
  type HomeBannerOption,
  type HomeBannerRow,
} from "./home-banners";

type PgLikeError = {
  code?: string | null;
  message?: string | null;
};

function formatError(error: PgLikeError | null | undefined): string | undefined {
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

export async function listHomeBanners(): Promise<{
  banners: HomeBannerRow[];
  lookups: HomeBannerLookups;
  error?: string;
}> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return { banners: [], lookups: { zones: [], partners: [], groups: [] }, error: auth.error };

  const supabase = await createClient();
  const [bannersRes, zonesRes, partnersRes, groupsRes] = await Promise.all([
    supabase
      .from("driver_home_banners")
      .select(
        "id, image_object_key, image_url, caption_en, caption_ar, deep_link, starts_at, ends_at, is_active, sort_order, zone_ids, partner_ids, driver_group_ids",
      )
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase.from("zones").select("id, name").order("name"),
    supabase.from("partners").select("id, name").order("name"),
    supabase.from("driver_groups").select("id, name").order("name"),
  ]);

  if (bannersRes.error) {
    return {
      banners: [],
      lookups: { zones: [], partners: [], groups: [] },
      error: formatError(bannersRes.error),
    };
  }

  await logAdminRead("driver_home_banners", "/settings/app");

  return {
    banners: (bannersRes.data ?? []) as HomeBannerRow[],
    lookups: {
      zones: (zonesRes.data ?? []) as HomeBannerOption[],
      partners: (partnersRes.data ?? []) as HomeBannerOption[],
      groups: (groupsRes.data ?? []) as HomeBannerOption[],
    },
  };
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

  const supabase = await createClient();
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
    const { error: uploadError } = await supabase.storage.from("branding").upload(path, buffer, {
      contentType: mimeByExt[ext as (typeof ALLOWED_SPLASH_EXTENSIONS)[number]],
      upsert: true,
    });
    if (uploadError) {
      return { error: "upload_failed", errorDetail: formatError(uploadError) };
    }
    const { data } = supabase.storage.from("branding").getPublicUrl(path);
    imageObjectKey = path;
    imageUrl = `${data.publicUrl}?v=${Date.now()}`;
    if (!id) {
      const { error } = await supabase.from("driver_home_banners").insert({
        id: bannerId,
        image_object_key: imageObjectKey,
        image_url: imageUrl,
        caption_en: captionEn,
        caption_ar: captionAr,
        deep_link: deepLink,
        starts_at: startsAt,
        ends_at: endsAt,
        is_active: isActive,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
        zone_ids: zoneIds,
        partner_ids: partnerIds,
        driver_group_ids: groupIds,
        created_by: auth.session.id,
      });
      if (error) return { error: "save_failed", errorDetail: formatError(error) };
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
    starts_at: startsAt,
    ends_at: endsAt,
    is_active: isActive,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    zone_ids: zoneIds,
    partner_ids: partnerIds,
    driver_group_ids: groupIds,
    updated_at: new Date().toISOString(),
    ...(imageObjectKey && imageUrl
      ? { image_object_key: imageObjectKey, image_url: imageUrl }
      : {}),
  };

  const { error } = await supabase.from("driver_home_banners").update(patch).eq("id", id!);
  if (error) return { error: "save_failed", errorDetail: formatError(error) };

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

  const supabase = await createClient();
  const { data } = await supabase
    .from("driver_home_banners")
    .select("image_object_key")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from("driver_home_banners").delete().eq("id", id);
  if (error) return { error: "save_failed", errorDetail: formatError(error) };

  const key = (data as { image_object_key?: string } | null)?.image_object_key;
  if (key) await supabase.storage.from("branding").remove([key]);

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
