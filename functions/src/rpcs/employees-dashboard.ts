import { onCall } from "firebase-functions/v2/https";
import { getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireStaff } from "../core/staff";
import { dataOf } from "./_shared";

type Bucket = { key: string; count: number };

const UNASSIGNED = "unassigned";

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function toBuckets(map: Map<string, number>): Bucket[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function stringKeys(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];
}

/**
 * `admin_employees_dashboard` — live HR counts. Archived rows are counted
 * separately and never enter the live buckets.
 */
export const adminEmployeesDashboard = onCall(async (request) => {
  const staff = await requireStaff(request, "drivers.view");

  const db = getFirestore();
  const [driversSnap, intakesSnap] = await Promise.all([
    db.collection(COLLECTIONS.drivers).select(
      "archived_at",
      "project_key",
      "partner_id",
      "employee_status_key",
      "nationality_category_keys",
      "section_keys",
    ).get(),
    db.collection(COLLECTIONS.driverIntakes).select(
      "archived_at",
      "linked_profile_id",
      "project_key",
      "partner_id",
      "employee_status_key",
      "nationality_category_keys",
      "section_keys",
    ).get(),
  ]);

  const seen = new Set<string>();
  const project = new Map<string, number>();
  const partner = new Map<string, number>();
  const status = new Map<string, number>();
  const nationality = new Map<string, number>();
  const section = new Map<string, number>();
  let archived = 0;
  let live = 0;

  const consider = (
    id: string,
    archivedAt: unknown,
    projectKey: unknown,
    partnerId: unknown,
    statusKey: unknown,
    nationalityKeys: unknown,
    sectionKeys: unknown,
  ) => {
    if (
      staff.isPartner &&
      String(projectKey ?? "").trim().toLowerCase() !== staff.partnerProjectKey
    ) {
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    if (archivedAt) {
      archived += 1;
      return;
    }
    live += 1;
    bump(project, typeof projectKey === "string" && projectKey ? projectKey : UNASSIGNED);
    bump(partner, typeof partnerId === "string" && partnerId ? partnerId : UNASSIGNED);
    bump(status, typeof statusKey === "string" && statusKey ? statusKey : UNASSIGNED);
    const nations = stringKeys(nationalityKeys);
    if (nations.length === 0) bump(nationality, UNASSIGNED);
    else for (const key of nations) bump(nationality, key);
    const sections = stringKeys(sectionKeys);
    if (sections.length === 0) bump(section, UNASSIGNED);
    else for (const key of sections) bump(section, key);
  };

  for (const doc of driversSnap.docs) {
    const row = dataOf(doc);
    consider(
      doc.id,
      row["archived_at"],
      row["project_key"],
      row["partner_id"],
      row["employee_status_key"],
      row["nationality_category_keys"],
      row["section_keys"],
    );
  }

  for (const doc of intakesSnap.docs) {
    const row = dataOf(doc);
    const linked = typeof row["linked_profile_id"] === "string" ? row["linked_profile_id"] : "";
    if (linked && seen.has(linked)) continue;
    consider(
      linked || doc.id,
      row["archived_at"],
      row["project_key"],
      row["partner_id"],
      row["employee_status_key"],
      row["nationality_category_keys"],
      row["section_keys"],
    );
  }

  return {
    total: live,
    archived,
    by_project: toBuckets(project),
    by_partner: toBuckets(partner),
    by_employee_status: toBuckets(status),
    by_nationality_category: toBuckets(nationality),
    by_section: toBuckets(section),
  };
});
