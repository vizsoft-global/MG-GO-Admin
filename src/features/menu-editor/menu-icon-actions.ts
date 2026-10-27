"use server";

import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import {
  menuIconObjectKey,
  menuIconUploadMeta,
  svgIconIsSafe,
} from "@/lib/menu/menu-icon";
import { putObject } from "@/lib/storage/r2-client";

export async function uploadMenuIcon(
  formData: FormData,
): Promise<{ url: string } | { error: string }> {
  const auth = await requireMutationAuth("settings.manage");
  if ("error" in auth) return { error: auth.error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "icon_type" };

  const meta = menuIconUploadMeta(file.type, file.size);
  if (meta === "icon_type" || meta === "icon_too_large") return { error: meta };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (meta.ext === "svg" && !svgIconIsSafe(new TextDecoder().decode(bytes))) {
    return { error: "icon_type" };
  }

  const fileName = `${crypto.randomUUID()}.${meta.ext}`;
  const key = menuIconObjectKey(fileName);
  if (!key) return { error: "icon_type" };

  try {
    await putObject(key, bytes, meta.contentType, {
      uploadedBy: auth.session.id,
      entityType: "menu_icon",
      entityId: fileName,
      uploadedVia: "admin",
    });
  } catch {
    return { error: "upload_failed" };
  }

  return { url: `/api/menu-icons/${fileName}` };
}
