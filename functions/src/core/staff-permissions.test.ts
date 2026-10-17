import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { setFirestoreFactoryForTests, type Firestore } from "./fs";
import {
  clearPermissionCache,
  mergePermissionSlugs,
  requireStaff,
  requireStaffFresh,
} from "./staff";

type Row = Record<string, unknown>;

const PROFILE = "profiles/u1";
const EPOCH = "auth_epochs/current";
const ROLE = "admin_role_permissions/role-1";
const TICKS = "admin_user_permissions/u1";
const CATALOG = "admin_permissions/permissions";

function createFakeFirestore(rows: Map<string, Row>) {
  const reads: string[] = [];
  const snapshot = (path: string) => {
    const data = rows.get(path);
    return { exists: data !== undefined, id: path.split("/")[1] ?? "", data: () => data };
  };
  const ref = (path: string) => ({
    path,
    get: async () => {
      reads.push(path);
      return snapshot(path);
    },
  });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    getAll: async (...refs: Array<{ path: string }>) => {
      const out = [];
      for (const item of refs) {
        reads.push(item.path);
        out.push(snapshot(item.path));
      }
      return out;
    },
  };
  return { db: db as unknown as Firestore, reads };
}

function staffRows(): Map<string, Row> {
  return new Map<string, Row>([
    [
      PROFILE,
      {
        role: "staff",
        approval_status: "approved",
        admin_role_id: "role-1",
        access_kind: "user",
      },
    ],
    [EPOCH, { access: 3, settings: 0, menu: 0, config: 0 }],
    [ROLE, { permission_slugs: ["drivers.view"] }],
    [TICKS, { permission_slugs: ["deliveries.view"] }],
    [CATALOG, { slugs: ["drivers.view", "deliveries.view", "earnings.manage"] }],
  ]);
}

function request(uid: string, superAdmin = false): CallableRequest<unknown> {
  return {
    auth: { uid, token: { superAdmin } },
    data: {},
  } as unknown as CallableRequest<unknown>;
}


describe("staff permission cache", () => {
  it("reads the profile every call and the permission docs once per epoch", async () => {
    clearPermissionCache();
    const rows = staffRows();
    const fake = createFakeFirestore(rows);
    setFirestoreFactoryForTests(() => fake.db);
    try {
      const first = await requireStaff(request("u1"));
      assert.deepEqual([...first.permissionSlugs].sort(), ["deliveries.view", "drivers.view"]);
      assert.equal(fake.reads.filter((path) => path === PROFILE).length, 1);

      fake.reads.length = 0;
      const second = await requireStaff(request("u1"));
      assert.deepEqual([...second.permissionSlugs].sort(), ["deliveries.view", "drivers.view"]);
      // The profile and the counter are the only two reads on a warm isolate.
      assert.deepEqual(fake.reads.slice().sort(), [EPOCH, PROFILE].sort());
    } finally {
      setFirestoreFactoryForTests(null);
      clearPermissionCache();
    }
  });

  it("re-reads the permission documents after the access counter moves", async () => {
    clearPermissionCache();
    const rows = staffRows();
    const fake = createFakeFirestore(rows);
    setFirestoreFactoryForTests(() => fake.db);
    try {
      await requireStaff(request("u1"));
      rows.set(EPOCH, { access: 4 });
      rows.set(ROLE, { permission_slugs: ["drivers.view", "earnings.manage"] });
      const after = await requireStaff(request("u1"));
      assert.deepEqual([...after.permissionSlugs].sort(), [
        "deliveries.view",
        "drivers.view",
        "earnings.manage",
      ]);
    } finally {
      setFirestoreFactoryForTests(null);
      clearPermissionCache();
    }
  });

  it("lets requireStaffFresh bypass the cache entirely", async () => {
    clearPermissionCache();
    const rows = staffRows();
    const fake = createFakeFirestore(rows);
    setFirestoreFactoryForTests(() => fake.db);
    try {
      await requireStaff(request("u1"));
      fake.reads.length = 0;
      await requireStaffFresh(request("u1"));
      assert.equal(fake.reads.includes(ROLE), true);
      assert.equal(fake.reads.includes(TICKS), true);
    } finally {
      setFirestoreFactoryForTests(null);
      clearPermissionCache();
    }
  });

  it("never caches when the counters document is missing", async () => {
    clearPermissionCache();
    const rows = staffRows();
    rows.delete(EPOCH);
    const fake = createFakeFirestore(rows);
    setFirestoreFactoryForTests(() => fake.db);
    try {
      await requireStaff(request("u1"));
      fake.reads.length = 0;
      await requireStaff(request("u1"));
      assert.equal(fake.reads.includes(ROLE), true);
      assert.equal(fake.reads.includes(TICKS), true);
    } finally {
      setFirestoreFactoryForTests(null);
      clearPermissionCache();
    }
  });

  it("resolves a manager from the catalog alone", async () => {
    clearPermissionCache();
    const rows = staffRows();
    const fake = createFakeFirestore(rows);
    setFirestoreFactoryForTests(() => fake.db);
    try {
      const staff = await requireStaff(request("u1", true));
      assert.equal(staff.isManager, true);
      assert.deepEqual([...staff.permissionSlugs].sort(), [
        "deliveries.view",
        "drivers.view",
        "earnings.manage",
      ]);
      assert.equal(fake.reads.includes(ROLE), false);
      assert.equal(fake.reads.includes(TICKS), false);
    } finally {
      setFirestoreFactoryForTests(null);
      clearPermissionCache();
    }
  });

  it("refuses an archived profile without touching permissions", async () => {
    clearPermissionCache();
    const rows = staffRows();
    rows.set(PROFILE, {
      role: "staff",
      approval_status: "approved",
      admin_role_id: "role-1",
      access_kind: "user",
      archived_at: "2026-10-17T00:00:00.000Z",
    });
    const fake = createFakeFirestore(rows);
    setFirestoreFactoryForTests(() => fake.db);
    try {
      await assert.rejects(
        () => requireStaff(request("u1")),
        (error: unknown) =>
          error instanceof HttpsError &&
          error.code === "permission-denied" &&
          error.message === "not_authorized",
      );
      assert.equal(fake.reads.includes(ROLE), false);
    } finally {
      setFirestoreFactoryForTests(null);
      clearPermissionCache();
    }
  });
});

describe("mergePermissionSlugs", () => {
  it("unions a role's slugs with the caller's own ticks", () => {
    const merged = mergePermissionSlugs(["a", "b"], ["b", "c"]);
    assert.deepEqual([...merged].sort(), ["a", "b", "c"]);
    assert.equal(merged.size, 3);
  });
});
