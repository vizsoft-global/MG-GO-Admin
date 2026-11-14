import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { DRIVER_ROSTER_SNAPSHOTS, bumpDriverRoster } from "./bump-driver-roster";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(ROOT, path)).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** Collections whose documents an Employees list row is built from. */
const ROSTER_COLLECTIONS = [
  "driverIntakes",
  "driverRestaurants",
  "driverIntakeRestaurants",
  "partners",
  "zones",
  "sourceCompanies",
  "restaurants",
];

/**
 * Panel files that write one of those collections directly and are known not to
 * change what a list row shows. Each needs a reason; a new writer that is not
 * here and does not bump fails the test below.
 */
const WRITERS_LEFT_ON_THE_TIME_LIMIT: Record<string, string> = {
  "src/features/roster/roster-data.ts":
    "writes restaurants.zone_id only; a list row shows the restaurant's name, not its zone",
};

/** The same collections under the names the staff client (`db.from("...")`) uses. */
const ROSTER_TABLES = [
  "driver_intakes",
  "driver_restaurants",
  "driver_intake_restaurants",
  "partners",
  "zones",
  "source_companies",
  "restaurants",
];

/**
 * Files that write a roster table and do not bump themselves, because every
 * caller of their helper is a wrapped action. A new caller fails the test.
 */
const TABLE_WRITERS_BUMPED_BY_THEIR_CALLER: Record<string, { helper: string; callers: string[] }> = {
  "src/features/drivers/import/driver-import-write.ts": {
    helper: "syncImportRestaurants",
    callers: [
      "src/features/drivers/drivers-import-actions.ts",
      "src/features/drivers/import/driver-import-replay-actions.ts",
    ],
  },
};

/** The server actions that are wrapped, file by file. */
const WRAPPED_ACTIONS: Record<string, string[]> = {
  "src/features/drivers/drivers-actions.ts": [
    "createDriverIntake",
    "updateDriverWorkflowStatus",
    "updateDriverIntake",
    "saveDriverPrivateInformation",
    "saveDriverProjectSettings",
  ],
  "src/features/drivers/driver-assign-actions.ts": [
    "assignDriverToRestaurant",
    "assignDriverToZone",
    "unassignDriverFromRestaurant",
  ],
  "src/features/drivers/drivers-import-actions.ts": [
    "applyDriverImportChunk",
    "applyDriverImportBatch",
  ],
  "src/features/drivers/drivers-import-job-actions.ts": ["processDriverImportChunk"],
  "src/features/drivers/import/driver-import-replay-actions.ts": [
    "undoDriverImport",
    "redoDriverImport",
    "undoDriverImportRows",
    "redoDriverImportRows",
  ],
  "src/features/zones/zones-actions.ts": ["createZone", "updateZone", "deleteZone"],
  "src/features/partners/partners-actions.ts": ["createPartner", "updatePartner", "deletePartner"],
  "src/features/restaurants/restaurants-actions.ts": ["saveRestaurant", "deleteRestaurant"],
  "src/features/dpd/dpd-actions.ts": ["saveRestaurant", "deleteRestaurant"],
  "src/features/vehicles/vehicles-actions.ts": [
    "saveVehicle",
    "assignVehicleDriver",
    "bulkAssignVehicleDrivers",
  ],
  "src/features/vehicles/vehicle-import-actions.ts": [
    "applyVehicleImport",
    "undoVehicleImport",
    "redoVehicleImport",
  ],
};

describe("stored Employees roster: panel-side invalidation", () => {
  it("moves the same counters the functions side moves", () => {
    const functionsSide = read("functions/src/router/read-snapshot.ts");
    const generation = /DRIVER_ROSTER_GENERATION = "([A-Za-z]+)"/.exec(functionsSide)?.[1];
    assert.equal(generation, DRIVER_ROSTER_SNAPSHOTS[0]);
    const block = /DRIVER_ROSTER_SNAPSHOTS = \[([\s\S]*?)\] as const/.exec(functionsSide)?.[1] ?? "";
    const names = block
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => (part === "DRIVER_ROSTER_GENERATION" ? generation : part.replace(/"/g, "")));
    assert.deepEqual(names, [...DRIVER_ROSTER_SNAPSHOTS]);
  });

  it("is one merged write to the generation document", async () => {
    const writes: { collection: string; doc: string; patch: Record<string, unknown>; options: unknown }[] = [];
    const db = {
      collection: (collection: string) => ({
        doc: (doc: string) => ({
          set: async (patch: Record<string, unknown>, options: unknown) => {
            writes.push({ collection, doc, patch, options });
          },
        }),
      }),
    } as unknown as Firestore;
    await bumpDriverRoster(db);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].collection, "page_read_generations");
    assert.equal(writes[0].doc, "current");
    assert.deepEqual(writes[0].options, { merge: true });
    assert.deepEqual(
      Object.keys(writes[0].patch).sort(),
      [...DRIVER_ROSTER_SNAPSHOTS, "updated_at"].sort(),
    );
  });

  it("never fails the action that called it", async () => {
    const db = {
      collection: () => {
        throw new Error("firestore is down");
      },
    } as unknown as Firestore;
    await assert.doesNotReject(bumpDriverRoster(db));
  });

  it("is called by every panel file that writes a roster collection directly", () => {
    const writeCall = /\.(set|update|create|delete)\(|\bbatch\(\)|runTransaction\(|bulkWriter\(/;
    const missing: string[] = [];
    for (const path of sourceFiles("src")) {
      const text = read(path);
      const touches = ROSTER_COLLECTIONS.filter((key) =>
        new RegExp(`COLLECTIONS\\.${key}\\b`).test(text),
      );
      if (touches.length === 0) continue;
      // A file may read a roster collection and write some other one. Only a
      // write whose statement names the roster collection counts.
      const writesRoster = touches.some((key) => {
        const pattern = new RegExp(
          `COLLECTIONS\\.${key}\\)[^;]{0,400}?\\.(set|update|create|delete)\\(`,
        );
        return pattern.test(text);
      });
      if (!writesRoster || !writeCall.test(text)) continue;
      if (text.includes("bumpDriverRoster(") || text.includes("withDriverRosterBump(")) continue;
      if (path in WRITERS_LEFT_ON_THE_TIME_LIMIT) continue;
      missing.push(`${path} (${touches.join(", ")})`);
    }
    assert.deepEqual(missing, []);
  });

  it("is called by every panel file that writes a roster table through the staff client", () => {
    // Most of the panel's writes to these tables are `db.from("driver_intakes").update(...)`,
    // which the `COLLECTIONS.x` scan above cannot see.
    const tables = ROSTER_TABLES.join("|");
    const write = new RegExp(
      `\\.from\\("(${tables})"\\)[^;]{0,600}?\\.(insert|update|upsert|delete)\\(`,
      "g",
    );
    const missing: string[] = [];
    let seen = 0;
    for (const path of sourceFiles("src")) {
      const text = read(path);
      const touched = [...new Set([...text.matchAll(write)].map((match) => match[1]))];
      if (touched.length === 0) continue;
      seen += 1;
      if (text.includes("bumpDriverRoster(") || text.includes("withDriverRosterBump(")) continue;
      if (path in TABLE_WRITERS_BUMPED_BY_THEIR_CALLER) continue;
      missing.push(`${path} (${touched.join(", ")})`);
    }
    assert.ok(seen >= 5, "the scan no longer finds the known writers; its pattern is stale");
    assert.deepEqual(missing, []);
  });

  it("reaches the unbumped table writers only from wrapped actions", () => {
    for (const [path, { helper, callers }] of Object.entries(TABLE_WRITERS_BUMPED_BY_THEIR_CALLER)) {
      const found = sourceFiles("src").filter(
        (file) => file !== path && read(file).includes(`${helper}(`),
      );
      assert.deepEqual(found.sort(), [...callers].sort(), `${helper} gained a caller`);
      for (const caller of callers) {
        assert.ok(read(caller).includes("withDriverRosterBump("), `${caller} does not bump`);
      }
    }
  });

  for (const [path, names] of Object.entries(WRAPPED_ACTIONS)) {
    it(`${path}: ${names.length} action(s) bump once, after their writes`, () => {
      const text = read(path);
      for (const name of names) {
        assert.ok(
          text.includes(`return withDriverRosterBump(() => ${name}Impl(...args));`),
          `${name} is not wrapped`,
        );
        assert.ok(text.includes(`\nasync function ${name}Impl(`), `${name}Impl is missing`);
        // A loop inside the file must call the unwrapped body: one bump per action.
        const inner = text.split(`export async function ${name}(`)[0] + text.split(`${name}Impl(...args));`)[1];
        assert.equal(inner.includes(`await ${name}(`), false, `${name} is called in a loop`);
      }
    });
  }

  it("bumps from the avatar helper, which three callers share", () => {
    const text = read("src/lib/storage/sync-driver-avatar.ts");
    assert.ok(text.includes("await bumpDriverRoster(db);"));
  });

  it("bumps after a returned error but not after a throw", async () => {
    const { withDriverRosterBump } = await import("./bump-driver-roster");
    await assert.rejects(
      withDriverRosterBump(async () => {
        throw new Error("refused");
      }),
      /refused/,
    );
  });
});
