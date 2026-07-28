import "server-only";

import { createClient } from "@/lib/supabase/server";
import { PERMISSION_CATALOG } from "@/lib/auth/permission-catalog";

/** Upsert catalog entries into admin_permissions (idempotent). */
export async function syncAdminPermissionsFromCatalog(): Promise<{
  error?: string;
  synced?: number;
}> {
  const supabase = await createClient();

  for (const entry of PERMISSION_CATALOG) {
    const { error } = await supabase.from("admin_permissions").upsert(
      {
        slug: entry.slug,
        label: entry.label,
        category: entry.category,
      },
      { onConflict: "slug" },
    );

    if (error) {
      return { error: error.message };
    }
  }

  return { synced: PERMISSION_CATALOG.length };
}
