import { createClient } from "@/lib/supabase/server";
import type { MenuNode } from "@/services/menu-config-service";

function formatMenuConfigError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const e = error as { message?: string; code?: string; details?: string };
  return [e.message, e.code, e.details].filter(Boolean).join(" — ") || "unknown";
}

/** Server-side menu config (authenticated session from cookies). */
export async function getMenuConfigServer(role: string): Promise<MenuNode[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("menu_configs")
    .select("config")
    .eq("role", role)
    .eq("scope", "global")
    .is("site_id", null)
    .maybeSingle();

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("getMenuConfigServer", formatMenuConfigError(error));
    }
    return [];
  }
  const cfg = data?.config as unknown;
  return Array.isArray(cfg) ? (cfg as MenuNode[]) : [];
}
