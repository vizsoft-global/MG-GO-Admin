import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { parseId, parseIdList } from "../core/query";
import { requireStaff } from "../core/staff";

/** Firestore `in` / `getAll` chunk, and the batch size for every id list here. */
const ID_CHUNK = 30;

/** `all` mode is the ONLY branch that filters on status — see the RPC's ELSE. */
const ALL_MODE_STATUSES: readonly string[] = ["active", "pending", "suspended"];

const AUDIENCE_MODES = ["all", "zone", "partner", "status", "custom", "group", "import"] as const;
type AudienceMode = (typeof AUDIENCE_MODES)[number];

type DriverRow = { id: string; data: Record<string, unknown> };

/** The caller's own name for each parameter, so `p_*` and camelCase both work. */
export function pickValue(data: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** A jsonb-ish spec: any non-array object, or `{}` — never null, never a list. */
export function asSpec(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function assertNever(value: never): never {
  throw new HttpsError("internal", `unhandled_audience_mode_${String(value)}`);
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/** A value usable as a Firestore document id — a `/` would be read as a path. */
function isDocumentId(value: string): boolean {
  return value.length > 0 && value.length <= 1500 && !value.includes("/");
}

/**
 * `coalesce(p_target_spec->>'mode','all')`, with anything the RPC does not
 * branch on (role / team / dynamic) kept as *unknown* rather than folded into
 * `all`, because the SQL sends those to the ELSE branch and `all` is narrower.
 */
function audienceMode(targetSpec: Record<string, unknown>): AudienceMode | null {
  const mode = targetSpec["mode"];
  const text = mode === undefined || mode === null ? "all" : typeof mode === "string" ? mode : String(mode);
  return (AUDIENCE_MODES as readonly string[]).includes(text) ? (text as AudienceMode) : null;
}

function specIds(spec: Record<string, unknown>, key: string): string[] {
  return parseIdList(spec[key]) ?? [];
}

/** Every live driver: `archived_at IS NULL AND NOT is_blocked`. */
async function loadLiveDrivers(): Promise<DriverRow[]> {
  const snapshot = await getFirestore()
    .collection(COLLECTIONS.drivers)
    .where(FIELDS.drivers.archivedAt, "==", null)
    .get();

  const rows: DriverRow[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data["is_blocked"] === true) continue;
    rows.push({ id: doc.id, data });
  }
  return rows;
}

/** The union of `driver_groups.member_ids` — the mirror of `driver_group_members`. */
async function loadGroupMemberIds(groupIds: string[]): Promise<Set<string>> {
  const members = new Set<string>();
  const ids = [...new Set(groupIds.filter(isDocumentId))];
  if (!ids.length) return members;

  const db = getFirestore();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const refs = ids
      .slice(i, i + ID_CHUNK)
      .map((id) => db.collection(COLLECTIONS.driverGroups).doc(id));
    const snapshots = await db.getAll(...refs);
    for (const snapshot of snapshots) {
      const raw = snapshot.data()?.["member_ids"];
      if (!Array.isArray(raw)) continue;
      for (const value of raw) {
        if (typeof value === "string" && value.length) members.add(value);
      }
    }
  }
  return members;
}

/** `ROWS` of `p_import_spec`, in order, with the two identity columns normalised. */
function importRows(importSpec: Record<string, unknown>): Record<string, unknown>[] {
  const rows = importSpec["rows"];
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

/**
 * `resolve_import_driver_ids` — the 2026-10-17 body, not the earlier
 * employee-id-only one: a row resolves by `employee_id` OR `driver_code`, and a
 * row whose two columns name two different riders resolves to NULL rather than
 * picking one. The live-driver scan is what the SQL join does; the fleet is ~900
 * documents, and every mode below needs the same set.
 */
export async function resolveImportDriverIdsForSpec(
  importSpec: Record<string, unknown>,
): Promise<string[]> {
  const rows = importRows(importSpec);
  if (!rows.length) return [];

  const byEmployeeId = new Map<string, string[]>();
  const byDriverCode = new Map<string, string[]>();
  for (const row of await loadLiveDrivers()) {
    const employeeId = asText(row.data[FIELDS.drivers.employeeId]);
    const driverCode = asText(row.data[FIELDS.drivers.driverCode]);
    if (employeeId) byEmployeeId.set(employeeId, [...(byEmployeeId.get(employeeId) ?? []), row.id]);
    if (driverCode) byDriverCode.set(driverCode, [...(byDriverCode.get(driverCode) ?? []), row.id]);
  }

  const resolved = new Set<string>();
  for (const row of rows) {
    const employeeId = trimmedOrNull(row["employee_id"]);
    const driverCode = trimmedOrNull(row["driver_code"]);
    const employeeHit = employeeId ? firstId(byEmployeeId.get(employeeId)) : null;
    const codeHit = driverCode ? firstId(byDriverCode.get(driverCode)) : null;
    if (employeeHit && codeHit && employeeHit !== codeHit) continue;
    const decided = employeeHit ?? codeHit;
    if (decided) resolved.add(decided);
  }
  return [...resolved];
}

function firstId(ids: string[] | undefined): string | null {
  if (!ids || !ids.length) return null;
  return [...ids].sort((a, b) => a.localeCompare(b))[0] ?? null;
}

/** The mode switch exactly as the RPC writes it, before any exclusion. */
async function resolveBaseIds(
  targetSpec: Record<string, unknown>,
  importSpec: Record<string, unknown>,
): Promise<string[]> {
  const mode = audienceMode(targetSpec);

  switch (mode) {
    case "import":
      return await resolveImportDriverIdsForSpec(importSpec);
    case "all": {
      const drivers = await loadLiveDrivers();
      return drivers.filter((row) => ALL_MODE_STATUSES.includes(asText(row.data[FIELDS.drivers.status]) ?? "")).map((row) => row.id);
    }
    case "zone": {
      const wanted = new Set(specIds(targetSpec, "zone_ids"));
      if (!wanted.size) return [];
      const drivers = await loadLiveDrivers();
      return drivers.filter((row) => wanted.has(asText(row.data[FIELDS.drivers.zoneId]) ?? "")).map((row) => row.id);
    }
    case "partner": {
      const wanted = new Set(specIds(targetSpec, "partner_ids"));
      if (!wanted.size) return [];
      const drivers = await loadLiveDrivers();
      return drivers.filter((row) => wanted.has(asText(row.data[FIELDS.drivers.partnerId]) ?? "")).map((row) => row.id);
    }
    case "status": {
      const wanted = new Set(specIds(targetSpec, "statuses"));
      if (!wanted.size) return [];
      const drivers = await loadLiveDrivers();
      return drivers.filter((row) => wanted.has(asText(row.data[FIELDS.drivers.status]) ?? "")).map((row) => row.id);
    }
    case "custom": {
      const wanted = new Set(specIds(targetSpec, "driver_ids"));
      if (!wanted.size) return [];
      const drivers = await loadLiveDrivers();
      return drivers.filter((row) => wanted.has(row.id)).map((row) => row.id);
    }
    case "group": {
      const members = await loadGroupMemberIds(specIds(targetSpec, "group_ids"));
      if (!members.size) return [];
      const drivers = await loadLiveDrivers();
      return drivers.filter((row) => members.has(row.id)).map((row) => row.id);
    }
    case null: {
      const drivers = await loadLiveDrivers();
      return drivers.map((row) => row.id);
    }
    default:
      return assertNever(mode);
  }
}

/**
 * `array(SELECT unnest(v_ids) EXCEPT SELECT … exclusion)` — the exclusion
 * subtracts by driver id only, which is what the RPC's exclusion_spec honours.
 */
async function resolveAudienceIds(
  targetSpec: Record<string, unknown>,
  exclusionSpec: Record<string, unknown>,
  importSpec: Record<string, unknown>,
): Promise<string[]> {
  const ids = await resolveBaseIds(targetSpec, importSpec);
  const excluded = new Set(specIds(exclusionSpec, "driver_ids"));
  if (!excluded.size) return ids;
  return ids.filter((id) => !excluded.has(id));
}

/**
 * `SELECT count(*) FROM drivers WHERE id = ANY(excluded)` — the estimate counts
 * an excluded rider whatever their status, so this is an existence check and not
 * a membership test against the audience above.
 */
async function countExistingDrivers(ids: string[]): Promise<number> {
  const unique = [...new Set(ids.filter(isDocumentId))];
  if (!unique.length) return 0;

  const db = getFirestore();
  let count = 0;
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const refs = unique
      .slice(i, i + ID_CHUNK)
      .map((id) => db.collection(COLLECTIONS.drivers).doc(id));
    const snapshots = await db.getAll(...refs);
    for (const snapshot of snapshots) {
      if (snapshot.exists) count += 1;
    }
  }
  return count;
}

export const resolveImportDriverIds = onCall(async (request) => {
  await requireStaff(request, "notifications.view");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const importSpec = asSpec(
    pickValue(data, ["p_import_spec", "importSpec", "import_spec"]),
  );
  return await resolveImportDriverIdsForSpec(importSpec);
});

export const estimateNotificationAudience = onCall(async (request) => {
  await requireStaff(request, "notifications.view");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const targetSpec = asSpec(pickValue(data, ["p_target_spec", "targetSpec", "target_spec"]));
  const exclusionSpec = asSpec(
    pickValue(data, ["p_exclusion_spec", "exclusionSpec", "exclusion_spec"]),
  );
  const importSpec = asSpec(
    pickValue(data, ["p_import_spec", "importSpec", "import_spec"]),
  );

  let count = (await resolveBaseIds(targetSpec, importSpec)).length;
  const excluded = specIds(exclusionSpec, "driver_ids");
  if (excluded.length) {
    count = Math.max(0, count - (await countExistingDrivers(excluded)));
  }
  return count;
});

export const compileNotificationAudienceIds = onCall(async (request) => {
  await requireStaff(request, "notifications.send");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const targetSpec = asSpec(pickValue(data, ["p_target_spec", "targetSpec", "target_spec"]));
  const exclusionSpec = asSpec(
    pickValue(data, ["p_exclusion_spec", "exclusionSpec", "exclusion_spec"]),
  );
  const importSpec = asSpec(
    pickValue(data, ["p_import_spec", "importSpec", "import_spec"]),
  );

  return await resolveAudienceIds(targetSpec, exclusionSpec, importSpec);
});

export const compileNotificationAudience = onCall(async (request) => {
  await requireStaff(request, "notifications.send");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const campaignId = parseId(
    pickValue(data, ["p_campaign_id", "campaignId", "campaign_id"]),
  );
  if (!campaignId || !isDocumentId(campaignId)) {
    throw new HttpsError("invalid-argument", "invalid_campaign_id");
  }

  const targetSpec = asSpec(pickValue(data, ["p_target_spec", "targetSpec", "target_spec"]));
  const exclusionSpec = asSpec(
    pickValue(data, ["p_exclusion_spec", "exclusionSpec", "exclusion_spec"]),
  );

  const db = getFirestore();
  const campaignRef = db.collection(COLLECTIONS.notificationCampaigns).doc(campaignId);
  const campaign = await campaignRef.get();

  const importSpec =
    audienceMode(targetSpec) === "import" ? asSpec(campaign.data()?.["import_spec"]) : {};

  const recipientIds = await resolveAudienceIds(targetSpec, exclusionSpec, importSpec);

  const snapshot = await db.collection(COLLECTIONS.notificationAudienceSnapshots).add({
    campaign_id: campaignId,
    target_spec: targetSpec,
    exclusion_spec: exclusionSpec,
    recipient_ids: recipientIds,
    recipient_count: recipientIds.length,
    created_at: FieldValue.serverTimestamp(),
  });

  if (campaign.exists) {
    await campaignRef.update({
      estimated_audience_count: recipientIds.length,
      updated_at: FieldValue.serverTimestamp(),
    });
  }

  return snapshot.id;
});
