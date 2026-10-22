"use server";

import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { writeWithEpochCounters } from "@/lib/auth/auth-epochs";
import {
  asEpochReader,
  getEpochCache,
  readEpochQuery,
  type EpochCounters,
} from "@/lib/auth/epoch-cache";
import { getSessionUser } from "@/lib/auth/get-session";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
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
  href?: string;
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
    const db = await staffDb();
    if (!db) return [];
    return await readEpochQuery(
      asEpochReader(db),
      getEpochCache(),
      "menu",
      `menu:${role}`,
      session.epochs.menu,
      async () => {
        const { docs } = await menuDocsForRole(role);
        return configOf(docs[0]?.data()?.config);
      },
    );
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("getMenuConfig", formatMenuConfigError(error));
    }
    return [];
  }
}

async function requireMenuMutation() {
  const auth = await requireMutationAuth();
  if ("error" in auth) throw new Error("not_authenticated");
  return auth.session;
}

export async function saveMenuConfig(role: string, config: MenuNode[]): Promise<EpochCounters> {
  const session = await requireMenuMutation();

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

  const written = await writeWithEpochCounters(db, "menu", ({ tx }) => {
    if (docs[0]) {
      tx.set(docs[0].ref, payload, { merge: true });
      return;
    }
    const id = crypto.randomUUID();
    tx.set(db.collection(COLLECTIONS.menuConfigs).doc(id), { id, ...payload });
  });
  return written.epochs;
}

export async function resetMenuConfig(role: string): Promise<EpochCounters> {
  await requireMenuMutation();

  const { db, docs } = await menuDocsForRole(role);
  if (!db) throw new Error("not_configured");
  const written = await writeWithEpochCounters(db, "menu", ({ tx }) => {
    for (const doc of docs) tx.delete(doc.ref);
  });
  return written.epochs;
}

/** Copy saved menu config from one role to another (overwrites target). */
export async function copyMenuConfig(fromRole: string, toRole: string): Promise<EpochCounters> {
  if (fromRole === toRole) {
    throw new Error("Source and target roles must differ");
  }
  const config = await getMenuConfig(fromRole);
  return saveMenuConfig(toRole, config);
}
