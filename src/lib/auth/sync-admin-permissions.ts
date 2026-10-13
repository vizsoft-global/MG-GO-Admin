import "server-only";

import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/db";
import { PERMISSION_CATALOG } from "@/lib/auth/permission-catalog";

/**
 * Upserts catalog entries into `admin_permissions` (idempotent, doc id = slug).
 *
 * The slug is the document id rather than a field, so re-running this cannot
 * create a second row for the same slug — the uniqueness Postgres enforced with
 * a constraint is now structural.
 */
export async function syncAdminPermissionsFromCatalog(): Promise<{
  error?: string;
  synced?: number;
}> {
  const db = await getFirebaseFirestore();
  if (!db) return { error: "firestore_unavailable" };

  const batch = db.batch();
  const now = new Date().toISOString();

  for (const entry of PERMISSION_CATALOG) {
    batch.set(
      db.collection(COLLECTIONS.adminPermissions).doc(entry.slug),
      {
        id: entry.slug,
        slug: entry.slug,
        label: entry.label,
        category: entry.category,
        updated_at: now,
      },
      { merge: true },
    );
  }

  try {
    await batch.commit();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "sync_failed" };
  }

  return { synced: PERMISSION_CATALOG.length };
}
