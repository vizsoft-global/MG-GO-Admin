"use server";

import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/get-session";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

function formatMenuConfigError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const e = error as { message?: string; code?: string; details?: string };
  return [e.message, e.code, e.details].filter(Boolean).join(" — ") || "unknown";
}

export type MenuNodeType = "item" | "group";

export interface MenuNode {
  id: string;
  type: MenuNodeType;
  label: string;
  icon: string;
  hidden?: boolean;
  displayMode?: "inline" | "panel";
  children?: MenuNode[];
}

function configOf(value: unknown): MenuNode[] {
  return Array.isArray(value) ? (value as MenuNode[]) : [];
}

async function menuDocsForRole(role: string) {
  const db = await staffDb();
  if (!db) return { db: null, docs: [] as QueryDocumentSnapshot[] };
  const snap = await db.collection(COLLECTIONS.menuConfigs).where("role", "==", role).get();
  const docs = snap.docs.filter((doc) => {
    const data = doc.data();
    return data.scope === "global" && data.site_id == null;
  });
  return { db, docs };
}

export async function getMenuConfig(role: string): Promise<MenuNode[]> {
  const session = await getSessionUser();
  if (!session) return [];

  try {
    const { docs } = await menuDocsForRole(role);
    return configOf(docs[0]?.data()?.config);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("getMenuConfig", formatMenuConfigError(error));
    }
    return [];
  }
}

export async function saveMenuConfig(role: string, config: MenuNode[]): Promise<void> {
  const session = await getSessionUser();
  if (!session) throw new Error("not_authenticated");

  const { db, docs } = await menuDocsForRole(role);
  if (!db) throw new Error("not_configured");

  const payload = {
    role,
    scope: "global",
    site_id: null,
    config,
    updated_at: new Date(),
    updated_by: session.id,
  };

  if (docs[0]) {
    await docs[0].ref.set(payload, { merge: true });
    return;
  }

  const id = crypto.randomUUID();
  await db.collection(COLLECTIONS.menuConfigs).doc(id).set({ id, ...payload });
}

export async function resetMenuConfig(role: string): Promise<void> {
  const session = await getSessionUser();
  if (!session) throw new Error("not_authenticated");

  const { db, docs } = await menuDocsForRole(role);
  if (!db) throw new Error("not_configured");
  await Promise.all(docs.map((doc) => doc.ref.delete()));
}

/** Copy saved menu config from one role to another (overwrites target). */
export async function copyMenuConfig(fromRole: string, toRole: string): Promise<void> {
  if (fromRole === toRole) {
    throw new Error("Source and target roles must differ");
  }
  const config = await getMenuConfig(fromRole);
  await saveMenuConfig(toRole, config);
}
