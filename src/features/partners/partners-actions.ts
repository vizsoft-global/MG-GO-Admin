"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  allPartnerLogoKeys,
  buildPartnerLogoKey,
} from "@/lib/storage/r2-keys";
import { deleteObjects, putObject } from "@/lib/storage/r2-client";
import { resolvePartnerLogoUrls } from "@/lib/storage/partner-logo-url";
import { slugifyPartnerName } from "./partner-slug";
import { mapPartnerDbError } from "./partner-errors";
import { resolvePartnerLogoMeta } from "./partner-logo";
import type { PartnerRow } from "./types";

async function requirePartnersManager() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "partners.manage", session.isSuperAdmin)
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
  supabase: SupabaseClient<Database>,
  baseSlug: string,
  excludeId?: string,
): Promise<string> {
  let candidate = baseSlug;
  let n = 2;
  while (true) {
    const { data } = await supabase
      .from("partners")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data || (excludeId && data.id === excludeId)) return candidate;
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

export async function fetchPartnersForAdmin(): Promise<PartnerRow[]> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "partners.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }

  void logAdminRead("partners", "fetchPartnersForAdmin");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("partners")
    .select("id, name, slug, description, logo_url, created_at, updated_at")
    .order("name");

  if (error) throw error;

  const partners = data ?? [];
  const ids = partners.map((p) => p.id);

  let driverCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: drivers } = await supabase
      .from("drivers")
      .select("partner_id")
      .in("partner_id", ids);

    for (const d of drivers ?? []) {
      if (!d.partner_id) continue;
      driverCounts.set(d.partner_id, (driverCounts.get(d.partner_id) ?? 0) + 1);
    }
  }

  const rows = partners.map((p) => ({
    ...p,
    description: p.description ?? null,
    driver_count: driverCounts.get(p.id) ?? 0,
  }));

  const withUrls = await resolvePartnerLogoUrls(rows);
  return withUrls.map(({ logo_display_url, ...p }) => ({
    ...p,
    logo_url: logo_display_url,
  }));
}

export async function createPartner(formData: FormData): Promise<PartnerMutationResult> {
  const auth = await requirePartnersManager();
  if ("error" in auth) return auth;

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const logoFile = formData.get("logo");
  if (!name) return { error: "missing_fields" };

  const supabase = await createClient();
  const slug = await uniquePartnerSlug(supabase, slugifyPartnerName(name));

  const { data, error } = await supabase
    .from("partners")
    .insert({ name, slug, description: description || null })
    .select("id")
    .single();

  if (error) return { error: mapPartnerDbError(error) };

  let logoUrl: string | undefined;
  let logoWarning: string | undefined;
  if (logoFile instanceof File && logoFile.size > 0) {
    const upload = await uploadPartnerLogoFile(
      data.id,
      logoFile,
      auth.session.id,
    );
    if (upload.error) {
      logoWarning = upload.error;
    } else {
      logoUrl = upload.logoUrl;
      if (logoUrl) {
        await supabase
          .from("partners")
          .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
          .eq("id", data.id);
      }
    }
  }

  void logAdminMutation({
    action: "create",
    entityType: "partner",
    entityId: data.id,
    routeName: "createPartner",
    after: { name, slug },
  });

  return { success: true, id: data.id, logoUrl, logoWarning };
}

export async function updatePartner(formData: FormData): Promise<PartnerMutationResult> {
  const auth = await requirePartnersManager();
  if ("error" in auth) return auth;

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const logoFile = formData.get("logo");
  const removeLogo = formData.get("removeLogo") === "true";
  if (!id || !name) return { error: "missing_fields" };

  const supabase = await createClient();

  const slug = await uniquePartnerSlug(supabase, slugifyPartnerName(name), id);

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
    updated_at: string;
    logo_url?: string | null;
  } = {
    name,
    slug,
    description: description || null,
    updated_at: new Date().toISOString(),
  };
  if (logoUrl !== undefined) patch.logo_url = logoUrl;

  const { error } = await supabase.from("partners").update(patch).eq("id", id);

  if (error) return { error: mapPartnerDbError(error) };

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
  const auth = await requirePartnersManager();
  if ("error" in auth) return auth;

  const supabase = await createClient();

  const { count, error: countError } = await supabase
    .from("drivers")
    .select("id", { count: "exact", head: true })
    .eq("partner_id", id);

  if (countError) return { error: mapPartnerDbError(countError) };
  if ((count ?? 0) > 0) return { error: "has_drivers" };

  const { count: restaurantCount, error: restaurantCountError } = await supabase
    .from("restaurants")
    .select("id", { count: "exact", head: true })
    .eq("partner_id", id);

  if (restaurantCountError) return { error: mapPartnerDbError(restaurantCountError) };
  if ((restaurantCount ?? 0) > 0) return { error: "has_restaurants" };

  const { error } = await supabase.from("partners").delete().eq("id", id);
  if (error) return { error: mapPartnerDbError(error) };

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
