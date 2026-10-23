import { COLLECTIONS } from "./collections";
import { getFirestore } from "./fs";

/**
 * Sections that ship non-operational. The Admin catalog seed adds the row to
 * `employee_sections` on read, but a fleet that has never opened that page has
 * no document yet, and the server must still treat its staff as office staff.
 */
const SEEDED_NON_OPERATIONAL = new Set(["service_field_mg_head_office"]);

/**
 * Every section key that needs no zone and no restaurant.
 *
 * The catalog row wins over the seed in both directions: an operator can mark a
 * custom section non-operational, and can turn the seeded one back on.
 */
export async function loadNonOperationalSectionKeys(): Promise<Set<string>> {
  const keys = new Set(SEEDED_NON_OPERATIONAL);
  const snap = await getFirestore().collection(COLLECTIONS.employeeSections).get();
  for (const doc of snap.docs) {
    const value = (doc.data() ?? {})["is_operational"];
    if (value === true) keys.delete(doc.id);
    else if (value === false) keys.add(doc.id);
  }
  return keys;
}

/**
 * True only when the rider has at least one section and every one of them is
 * non-operational. No section keeps the gate: a missing HR section is a data
 * gap, not a desk job.
 */
export function isNonOperationalOnly(
  sectionKeys: readonly string[],
  nonOperational: ReadonlySet<string>,
): boolean {
  if (sectionKeys.length === 0) return false;
  return sectionKeys.every((key) => nonOperational.has(key));
}

/** The rider document's own `section_keys`, resolved against the catalog. */
export async function riderIsNonOperational(driver: Record<string, unknown>): Promise<boolean> {
  const raw = driver["section_keys"];
  const keys = Array.isArray(raw)
    ? raw.filter((key): key is string => typeof key === "string" && key.trim() !== "")
    : [];
  if (keys.length === 0) return false;
  return isNonOperationalOnly(keys, await loadNonOperationalSectionKeys());
}
