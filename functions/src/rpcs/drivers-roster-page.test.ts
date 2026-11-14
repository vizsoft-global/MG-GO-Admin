import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  driversPageResult,
  selectDriversPage,
  type DriversPageCaller,
  type DriversPageQuery,
} from "./drivers";
import { DRIVER_ROSTER_GENERATION } from "../router/read-snapshot";
import {
  readThroughRoster,
  type RosterPartDoc,
  type RosterStoreBackend,
} from "../router/roster-snapshot";

/**
 * The Employees list may be cut from a roster that was just built, or from the
 * same roster read back out of the shared store. These cases hold the two to
 * the same answer, argument for argument and caller for caller.
 */

type Row = Record<string, unknown>;

function memoryBackend() {
  const generations = new Map<string, number>();
  const docs = new Map<string, RosterPartDoc>();
  const counts = { generationReads: 0, docReads: 0 };
  const backend: RosterStoreBackend = {
    async generation(name) {
      counts.generationReads += 1;
      return generations.get(name) ?? 0;
    },
    async read(ids) {
      counts.docReads += ids.length;
      return ids.map((id) => docs.get(id) ?? null);
    },
    async write(rows) {
      for (const row of rows) docs.set(row.id, row.doc);
    },
  };
  return { backend, docs, counts };
}

const PROJECTS = ["keeta", "americana", "five_guys", null];
const ZONES = ["Salmiya", "Hawally", "Farwaniya", "Jahra", null];
const NAMES = ["Ahmed", "Bilal", "Chandra", "Deepak", "Elias", "Farid", "Ganesh", "Hamza", "Imran", "Joseph"];

/** The shape `loadDriverRows` returns for the deferred roster: no driver document read. */
function rosterRows(count: number): Row[] {
  let seed = 11;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  return Array.from({ length: count }, (_, index) => {
    const linked = index % 9 !== 0;
    const project = PROJECTS[index % PROJECTS.length];
    const zone = ZONES[index % ZONES.length];
    const phone = `+965 5${String(next() % 10_000_000).padStart(7, "0")}`;
    return {
      id: `intake-${String(index).padStart(4, "0")}`,
      created_at: new Date(1_760_000_000_000 + index * 3_600_000),
      driver_code: `DRV${1000 + index}`,
      mg_id: index % 13 === 0 ? null : `MG${5000 + index}`,
      full_name: `${NAMES[next() % NAMES.length]} ${NAMES[next() % NAMES.length]} ${next().toString(36)}`,
      phone,
      phone_digits: phone.replace(/\D/g, ""),
      partner_id: index % 4 === 0 ? null : `partner-${index % 3}`,
      partner_name: index % 4 === 0 ? null : `Partner ${index % 3}`,
      partner_logo_key: index % 4 === 0 ? null : `logos/partner-${index % 3}.png`,
      zone_id: zone ? `zone-${zone.toLowerCase()}` : null,
      zone_name: zone,
      vehicle_id: index % 5 === 0 ? null : `vehicle-${index}`,
      vehicle_label: index % 5 === 0 ? null : `${10 + (index % 80)}/${10_000 + index}`,
      vehicle_type_key: index % 7 === 0 ? "car" : "bike",
      assigned_vehicle_type_key: index % 5 === 0 ? null : index % 7 === 0 ? "car" : "bike",
      restaurant_ids: index % 3 === 0 ? [] : [`rest-${index % 11}`, `rest-${index % 17}`],
      restaurant_names: index % 3 === 0 ? [] : [`Restaurant ${index % 11}`, `Restaurant ${index % 17}`],
      workflow_status: index % 10 === 0 ? "pending" : "approved",
      linked,
      linked_profile_id: linked ? `driver-${index}` : null,
      account_status: "pending",
      status_key: "pending",
      is_blocked: false,
      is_on_duty: false,
      attendance_key: "off_duty",
      today_deliveries: 0,
      app_passcode: null,
      archived_at: null,
      avatar_url: index % 6 === 0 ? `https://example.invalid/avatars/${index}.jpg` : null,
      avatar_object_key: null,
      rider_category: index % 8 === 0 ? "outsourced" : "in_house",
      source_company: index % 8 === 0 ? "acme" : null,
      company_key: index % 8 === 0 ? "acme" : "mg",
      company_name: index % 8 === 0 ? "Acme Logistics" : "Musallam Group",
      company_client_code: index % 8 === 0 ? "CL-0007" : "CL-0001",
      company_tone: index % 8 === 0 ? "partner" : "mg",
      client_id: `C${next() % 100_000}`,
      client_name: project ? project.toUpperCase() : null,
      custom_fields: index % 4 === 0 ? {} : { shirt: ["S", "M", "L"][index % 3], badges: ["a", "b"], locker: index },
      multi_device: false,
      employee_status_key: index % 6 === 0 ? "resigned" : "running",
      section_keys: index % 2 === 0 ? ["riders"] : ["riders", "night"],
      nationality_category_keys: [["arab", "asian", "african"][index % 3]],
      project_key: project,
      civil_id: `2${String(next() % 100_000_000_000).padStart(11, "0")}`,
      passport_number: `P${next() % 10_000_000}`,
    } satisfies Row;
  });
}

const FLEET_KPIS = {
  total: 960,
  activeToday: 700,
  onlineNow: 210,
  inactive: 490,
  pendingVerification: 60,
  suspended: 4,
};

const MANAGER: DriversPageCaller = { isPartner: false, partnerProjectKey: null, seesFleet: true, project: null };
const MANAGER_ONE_PROJECT: DriversPageCaller = { ...MANAGER, project: "americana" };
const PORTAL_STAFF: DriversPageCaller = { isPartner: false, partnerProjectKey: null, seesFleet: false, project: "five_guys" };
const PORTAL_STAFF_NO_PROJECT: DriversPageCaller = { ...PORTAL_STAFF, project: null };
const PARTNER: DriversPageCaller = { isPartner: true, partnerProjectKey: "keeta", seesFleet: false, project: null };
const PARTNER_NO_KEY: DriversPageCaller = { ...PARTNER, partnerProjectKey: null };

const DEFAULT_QUERY: DriversPageQuery = {
  tab: "all",
  search: null,
  searchField: "all",
  groupBy: "none",
  filters: {},
  sortKey: "name",
  desc: false,
  limit: 500,
  offset: 0,
};

const QUERIES: Record<string, DriversPageQuery> = {
  "the page the panel opens with": DEFAULT_QUERY,
  "the second page": { ...DEFAULT_QUERY, offset: 500 },
  "a small page from the middle, descending": { ...DEFAULT_QUERY, limit: 40, offset: 120, desc: true },
  "sorted by driver id": { ...DEFAULT_QUERY, sortKey: "driverId" },
  "sorted by company": { ...DEFAULT_QUERY, sortKey: "companyName", desc: true },
  "grouped by zone": { ...DEFAULT_QUERY, groupBy: "zone" },
  "grouped by project": { ...DEFAULT_QUERY, groupBy: "project", limit: 100 },
  "the pending tab": { ...DEFAULT_QUERY, tab: "pending" },
  "a name search": { ...DEFAULT_QUERY, search: "ahm", searchField: "name" },
  "a search across every field": { ...DEFAULT_QUERY, search: "sal" },
  "a list filter": { ...DEFAULT_QUERY, filters: { zone: { in: ["zone-salmiya", "zone-jahra"] } } },
  "a text filter with a custom-field filter": {
    ...DEFAULT_QUERY,
    filters: { name: { contains: "a" }, "cf:shirt": { in: ["M"] } },
  },
  "sorted by a custom field": { ...DEFAULT_QUERY, sortKey: "cf:locker" },
};

const CALLERS: Record<string, DriversPageCaller> = {
  "a manager": MANAGER,
  "a manager held to one project": MANAGER_ONE_PROJECT,
  "portal staff with a project": PORTAL_STAFF,
  "portal staff with no project": PORTAL_STAFF_NO_PROJECT,
  "a partner": PARTNER,
  "a partner with no project key": PARTNER_NO_KEY,
};

function page(rows: Row[], caller: DriversPageCaller, query: DriversPageQuery) {
  // The handler works on copies, exactly as `loadBaseRows` hands them out.
  return driversPageResult(
    selectDriversPage(rows.map((row) => ({ ...row })), FLEET_KPIS, caller, query),
  );
}

async function storedRows(rows: Row[], store = memoryBackend()) {
  const input = {
    name: DRIVER_ROSTER_GENERATION,
    key: "rows|live|defer|v1",
    ttlMs: 600_000,
    load: async () => rows,
  };
  const first = await readThroughRoster<Row[]>(input, store.backend);
  assert.equal(first.outcome, "miss");
  assert.equal(first.stored, true);
  store.counts.generationReads = 0;
  store.counts.docReads = 0;
  const read = () =>
    readThroughRoster<Row[]>(
      { ...input, load: async () => assert.fail("the stored roster was not used") },
      store.backend,
    );
  return { store, read };
}

describe("Employees list cut from the stored roster", () => {
  const direct = rosterRows(960);

  it("stores a fleet of 960 in one document: two reads per opening", async () => {
    const { store, read } = await storedRows(direct);
    const hit = await read();
    assert.equal(hit.outcome, "hit");
    assert.equal(store.docs.size, 1, "the roster should not need a second part");
    assert.deepEqual(store.counts, { generationReads: 1, docReads: 1 });
    assert.equal(hit.storeReads, 2);
    const [head] = [...store.docs.values()];
    assert.ok(head.packed.length < 450_000, `packed roster is ${head.packed.length} bytes`);
    if (process.env.ROSTER_TEST_PRINT === "1") console.log(`packed roster: ${head.packed.length} bytes`);
  });

  it("reads back exactly the rows that were built", async () => {
    const { read } = await storedRows(direct);
    const hit = await read();
    assert.deepEqual(hit.value, direct);
    assert.ok(hit.value[0]["created_at"] instanceof Date);
    assert.equal(hit.value[0]["archived_at"], null);
  });

  for (const [callerLabel, caller] of Object.entries(CALLERS)) {
    it(`gives ${callerLabel} the same page as the direct path, for every query`, async () => {
      const { read } = await storedRows(direct);
      for (const [queryLabel, query] of Object.entries(QUERIES)) {
        const fromStore = page((await read()).value, caller, query);
        const fromDirect = page(direct, caller, query);
        assert.deepEqual(fromStore, fromDirect, `${callerLabel}: ${queryLabel}`);
      }
    });
  }

  it("is not an empty comparison: the cases return rows, groups and totals", () => {
    const opened = page(direct, MANAGER, DEFAULT_QUERY);
    assert.equal(opened.rows.length, 500);
    assert.equal(opened.filtered_total, 960);
    assert.deepEqual(opened.kpis, FLEET_KPIS);
    assert.equal(page(direct, MANAGER, QUERIES["the second page"]).rows.length, 460);
    assert.ok(page(direct, MANAGER, QUERIES["grouped by zone"]).group_counts.length >= 5);
    assert.ok(page(direct, MANAGER, QUERIES["a name search"]).filtered_total > 0);
    assert.ok(page(direct, MANAGER, QUERIES["a list filter"]).filtered_total > 0);
    assert.ok(page(direct, MANAGER, QUERIES["a text filter with a custom-field filter"]).filtered_total > 0);
    assert.equal(page(direct, PARTNER, DEFAULT_QUERY).filtered_total, 240);
    assert.equal(page(direct, PARTNER_NO_KEY, DEFAULT_QUERY).filtered_total, 0);
    assert.equal(page(direct, PORTAL_STAFF_NO_PROJECT, DEFAULT_QUERY).filtered_total, 0);
  });

  it("masks a partner's page after the read, and only that page", async () => {
    const { read } = await storedRows(direct);
    const partnerPage = page((await read()).value, PARTNER, DEFAULT_QUERY);
    assert.ok(partnerPage.rows.length > 0);
    for (const row of partnerPage.rows) {
      assert.equal(row["project_key"], "keeta");
      for (const hidden of ["phone", "passport_number", "app_passcode", "company_name", "source_company", "is_blocked"]) {
        assert.equal(hidden in row, false, `a partner row carries ${hidden}`);
      }
      // What the partner is allowed to see is still there.
      assert.equal(typeof row["full_name"], "string");
      assert.equal(typeof row["driver_code"], "string");
    }

    // The manager who reads the same stored roster next sees every field and
    // every project: nothing of the partner's view was written to the store.
    const managerPage = page((await read()).value, MANAGER, DEFAULT_QUERY);
    assert.deepEqual(managerPage, page(direct, MANAGER, DEFAULT_QUERY));
    assert.ok(managerPage.rows.every((row) => typeof row["phone"] === "string" && "passport_number" in row));
    assert.ok(new Set(managerPage.rows.map((row) => row["project_key"])).size > 1);
    assert.deepEqual((await read()).value, direct);
  });

  it("stores no caller, no scope and no masked copy: one shared document", async () => {
    const { store, read } = await storedRows(direct);
    for (const caller of Object.values(CALLERS)) page((await read()).value, caller, DEFAULT_QUERY);
    assert.equal(store.docs.size, 1);
    const stored = (await read()).value;
    assert.equal(stored.length, 960);
    assert.ok(stored.every((row) => typeof row["phone"] === "string"));
  });

  it("holds no rider passcode: the deferred roster reads no driver document", () => {
    assert.ok(direct.every((row) => row["app_passcode"] === null));
  });
});
