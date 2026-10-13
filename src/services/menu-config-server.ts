import { getSessionUser } from "@/lib/auth/get-session";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import type { MenuNode } from "@/services/menu-config-service";

function formatMenuConfigError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const e = error as { message?: string; code?: string; details?: string };
  return [e.message, e.code, e.details].filter(Boolean).join(" — ") || "unknown";
}

function configOf(value: unknown): MenuNode[] {
  return Array.isArray(value) ? (value as MenuNode[]) : [];
}

/** Server-side menu config (authenticated session from cookies). */
export async function getMenuConfigServer(role: string): Promise<MenuNode[]> {
  const session = await getSessionUser();
  if (!session) return [];

  try {
    const db = await staffDb();
    if (!db) return [];

    const snap = await db.collection(COLLECTIONS.menuConfigs).where("role", "==", role).get();
    const match = snap.docs.find((doc) => {
      const data = doc.data();
      return data.scope === "global" && data.site_id == null;
    });
    return configOf(match?.data()?.config);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("getMenuConfigServer", formatMenuConfigError(error));
    }
    return [];
  }
}
