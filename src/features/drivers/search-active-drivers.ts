import type { DocumentData, Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

export type ActiveDriverHit = {
  id: string;
  driver_code: string;
  employee_id: string;
  full_name: string;
};

/**
 * Split a search box value into a name and/or a numeric id.
 *
 * `"Shambhavi Testing (10084)"` is the shape the panel prints on a row and
 * therefore the shape operators paste back. Reducing it to
 * `"Shambhavi Testing 10084"` and then matching the whole string against
 * `full_name` (the previous behaviour) found nothing, because the profile name
 * is `"Shambhavi Testing"` and the code lives in a different column.
 */
export function parseSearchTerm(query: string): { name: string; id: string } {
  const cleaned = query
    .replace(/[%(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { name: "", id: "" };
  const trailing = cleaned.match(/^(.*?)\s*(\d{4,8})$/);
  if (trailing) return { name: trailing[1]!.trim(), id: trailing[2]! };
  return { name: cleaned, id: "" };
}

type ProfileHit = { full_name: string; phone: string };

function asText(value: unknown): string {
  return value == null ? "" : String(value);
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

async function loadProfiles(
  db: Firestore,
  ids: string[],
): Promise<Map<string, ProfileHit>> {
  const out = new Map<string, ProfileHit>();
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const refs = chunk.map((id) => db.collection(COLLECTIONS.profiles).doc(id));
    const docs = await db.getAll(...refs);
    for (const doc of docs) {
      if (!doc.exists) continue;
      const data = doc.data() ?? {};
      out.set(doc.id, {
        full_name: asText(data.full_name),
        phone: asText(data.phone),
      });
    }
  }
  return out;
}

function isArchived(data: DocumentData): boolean {
  return data.archived_at != null;
}

/**
 * Search live drivers by name, driver code, employee id, or phone.
 * Active and non-archived only. Name also resolves through approved intakes
 * that already carry a linked profile.
 */
export async function searchActiveDrivers(
  query: string,
  limit = 30,
): Promise<ActiveDriverHit[]> {
  const { name, id } = parseSearchTerm(query);
  if (!name && !id) return [];

  const db = await staffDb();
  if (!db) return [];

  const [driverSnap, intakeSnap] = await Promise.all([
    db.collection(COLLECTIONS.drivers).get(),
    name ? db.collection(COLLECTIONS.driverIntakes).get() : Promise.resolve(null),
  ]);

  const nameIds = new Set<string>();
  if (name && intakeSnap) {
    for (const doc of intakeSnap.docs) {
      const data = doc.data();
      if (isArchived(data)) continue;
      if (!contains(asText(data.full_name), name)) continue;
      if (data.linked_profile_id) nameIds.add(String(data.linked_profile_id));
    }
  }

  const candidates: Array<{ id: string; data: DocumentData }> = [];
  for (const doc of driverSnap.docs) {
    const data = doc.data();
    if (isArchived(data)) continue;
    if (data.status !== "active") continue;
    candidates.push({ id: doc.id, data });
  }

  const profiles = await loadProfiles(
    db,
    candidates.map((row) => row.id),
  );

  if (name) {
    for (const [profileId, profile] of profiles) {
      if (contains(profile.full_name, name)) nameIds.add(profileId);
    }
  }

  const hits: ActiveDriverHit[] = [];
  for (const row of candidates) {
    const profile = profiles.get(row.id);
    const fullName = profile?.full_name.trim() || asText(row.data.full_name).trim() || "Driver";
    const employeeId = asText(row.data.employee_id);
    const driverCode = asText(row.data.driver_code);
    const phone = profile?.phone || asText(row.data.phone);

    const idHit =
      !!id &&
      (contains(employeeId, id) || contains(driverCode, id) || contains(phone, id));
    const nameHit =
      !!name &&
      (nameIds.has(row.id) || contains(fullName, name) || contains(phone, name));
    if (!idHit && !nameHit) continue;

    hits.push({
      id: row.id,
      driver_code: driverCode,
      employee_id: employeeId,
      full_name: fullName,
    });
    if (hits.length >= limit) break;
  }

  return hits;
}
