import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { writeWithEpoch } from "./auth-epochs";
import {
  EPOCH_CACHE_MAX_TTL_MS,
  createEpochCache,
  readEpochAndDocs,
  readEpochSettings,
  sessionRevokedForMutation,
  sessionRevokedForRead,
  type DocRef,
  type DocSnap,
  type EpochReader,
} from "./epoch-cache";
import { loadMutationSession, loadReadSession, type EpochProbe } from "./epoch-session";
import { panelGate, signedInEntryRedirect } from "./staff-entry";
import { applyReturnedEpochs } from "../menu/apply-returned-epochs";

/**
 * Out of scope for the writer grep (they still write app_settings without
 * writeWithEpoch): src/features/performance/performance-actions.ts
 * updatePerformanceScoreWeights, src/features/esign/esign-actions.ts
 * updateEsignScreenshotDefault, src/features/attendance/attendance-reporting-actions.ts.
 */

type Stored = Record<string, unknown>;

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (value && typeof value === "object") {
    const record = value as { methodName?: string };
    if (typeof record.methodName === "string") return value;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = clone(item);
    }
    return out as T;
  }
  return value;
}

function isIncrement(value: unknown): value is { operand?: number } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { methodName?: string }).methodName === "FieldValue.increment"
  );
}

function isServerTimestamp(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { methodName?: string }).methodName === "FieldValue.serverTimestamp"
  );
}

type FakeDb = EpochReader & {
  runTransaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T>;
  seed(path: string, data: Stored): void;
  read(path: string): Stored | undefined;
  afterEpochRead: (() => Promise<void>) | null;
};

type FakeTx = {
  get(ref: DocRef): Promise<DocSnap>;
  set(ref: DocRef, data: Stored, options?: { merge?: boolean }): void;
  delete(ref: DocRef): void;
};

function createFakeDb(): FakeDb {
  const docs = new Map<string, Stored>();
  let afterEpochRead: (() => Promise<void>) | null = null;

  function snap(docPath: string): DocSnap {
    const data = docs.get(docPath);
    if (!data) return { exists: false, data: () => undefined };
    const copy = clone(data);
    return { exists: true, data: () => copy };
  }

  function applySet(docPath: string, data: Stored, merge: boolean) {
    const current = merge ? { ...(docs.get(docPath) ?? {}) } : {};
    for (const [key, value] of Object.entries(data)) {
      if (isIncrement(value)) {
        const previous = current[key];
        const base = typeof previous === "number" ? previous : 0;
        current[key] = base + (typeof value.operand === "number" ? value.operand : 1);
      } else if (isServerTimestamp(value)) {
        current[key] = new Date();
      } else {
        current[key] = clone(value);
      }
    }
    docs.set(docPath, current);
  }

  function ref(docPath: string): DocRef {
    return {
      id: docPath.split("/").pop() ?? docPath,
      path: docPath,
      get: async () => snap(docPath),
    };
  }

  const db: FakeDb = {
    collection(name: string) {
      return { doc: (id: string) => ref(`${name}/${id}`) };
    },
    async getAll(...refs: DocRef[]) {
      const split =
        refs.length > 1 && refs[0]?.path === "auth_epochs/current" && afterEpochRead;
      if (!split) return refs.map((item) => snap(item.path));
      const epoch = snap(refs[0]!.path);
      const hook = afterEpochRead;
      afterEpochRead = null;
      await hook!();
      return [epoch, ...refs.slice(1).map((item) => snap(item.path))];
    },
    async runTransaction(fn) {
      const writes: Array<{ kind: "set"; path: string; data: Stored; merge: boolean } | { kind: "delete"; path: string }> = [];
      const tx: FakeTx = {
        get: async (item) => snap(item.path),
        set(item, data, options) {
          writes.push({ kind: "set", path: item.path, data, merge: options?.merge === true });
        },
        delete(item) {
          writes.push({ kind: "delete", path: item.path });
        },
      };
      const result = await fn(tx);
      for (const write of writes) {
        if (write.kind === "delete") docs.delete(write.path);
        else applySet(write.path, write.data, write.merge);
      }
      return result;
    },
    seed(docPath, data) {
      docs.set(docPath, clone(data));
    },
    read(docPath) {
      const data = docs.get(docPath);
      return data ? clone(data) : undefined;
    },
    get afterEpochRead() {
      return afterEpochRead;
    },
    set afterEpochRead(hook) {
      afterEpochRead = hook;
    },
  };
  return db;
}

function asFirestore(db: FakeDb): Firestore {
  return db as unknown as Firestore;
}

function probe(uid: string, authTimeMs: number | null): EpochProbe {
  return { uid, claims: { superAdmin: false }, unavailable: false, authTimeMs };
}

function staffProfile(extra: Stored = {}): Stored {
  return {
    role: "staff",
    approval_status: "approved",
    admin_role_id: "role-1",
    archived_at: null,
    access_kind: "manager",
    email: "staff@example.com",
    ...extra,
  };
}

function seedCatalog(db: FakeDb, slugs: string[]) {
  db.seed("admin_permissions/catalog", { slugs });
  db.seed("admin_roles/role-1", { slug: "operator" });
}

test("first request after revoke is rejected", async () => {
  const db = createFakeDb();
  const revokedAt = 1_700_000_000_000;
  db.seed("auth_epochs/current", { access: 1, settings: 1, menu: 1 });
  db.seed("profiles/u1", staffProfile({ sessions_revoked_at: revokedAt }));
  seedCatalog(db, ["drivers.view"]);

  const outcome = await loadReadSession(
    db,
    createEpochCache(),
    probe("u1", revokedAt - 10_000),
  );
  assert.equal(outcome.session, null);
  assert.equal(outcome.revoked, true);
});

test("epoch bump misses on a second isolate", async () => {
  const db = createFakeDb();
  db.seed("auth_epochs/current", { access: 1 });
  db.seed("admin_permissions/catalog", { slugs: ["old"] });
  const isolateA = createEpochCache();
  const catalog = {
    id: "catalog",
    ref: db.collection("admin_permissions").doc("catalog"),
  };

  const first = await readEpochAndDocs(db, isolateA, "access", 1, [catalog]);
  assert.equal(first.hit, false);
  assert.deepEqual(first.values[0]?.data?.slugs, ["old"]);
  const again = await readEpochAndDocs(db, isolateA, "access", 1, [catalog]);
  assert.equal(again.hit, true);

  await writeWithEpoch(asFirestore(db), "access", ({ tx }) => {
    tx.set(db.collection("admin_permissions").doc("catalog"), { slugs: ["new"] }, { merge: true });
  });
  assert.equal(db.read("auth_epochs/current")?.access, 2);

  const isolateB = createEpochCache();
  const filled = await readEpochAndDocs(db, isolateB, "access", 2, [catalog]);
  assert.equal(filled.hit, false);
  assert.deepEqual(filled.values[0]?.data?.slugs, ["new"]);

  const nextA = await readEpochAndDocs(db, isolateA, "access", 2, [catalog]);
  assert.equal(nextA.hit, false);
  assert.deepEqual(nextA.values[0]?.data?.slugs, ["new"]);
});

test("epoch race never stores the new epoch with the old data", async () => {
  const db = createFakeDb();
  db.seed("auth_epochs/current", { access: 1 });
  db.seed("admin_permissions/catalog", { slugs: ["before"] });
  const isolateA = createEpochCache();
  const catalog = {
    id: "catalog",
    ref: db.collection("admin_permissions").doc("catalog"),
  };

  db.afterEpochRead = async () => {
    await writeWithEpoch(asFirestore(db), "access", ({ tx }) => {
      tx.set(
        db.collection("admin_permissions").doc("catalog"),
        { slugs: ["after"] },
        { merge: true },
      );
    });
  };

  const filled = await readEpochAndDocs(db, isolateA, "access", 0, [catalog]);
  const stored = isolateA.snapshot().find((entry) => entry.id === "catalog");
  assert.ok(stored);
  const slugs = stored.doc.data?.slugs;
  const newEpochOldData = stored.epoch === 2 && Array.isArray(slugs) && slugs[0] === "before";
  assert.equal(newEpochOldData, false);
  assert.equal(stored.epoch === 1 || (stored.epoch === 2 && Array.isArray(slugs) && slugs[0] === "after"), true);
  assert.equal(filled.hit, false);

  const next = await readEpochAndDocs(db, isolateA, "access", 2, [catalog]);
  assert.equal(next.hit, false);
  assert.deepEqual(next.values[0]?.data?.slugs, ["after"]);
});

test("revoked user cannot mutate", async () => {
  const db = createFakeDb();
  const revokedAt = 1_700_000_000_000;
  db.seed("auth_epochs/current", { access: 4 });
  db.seed("profiles/u1", staffProfile({ sessions_revoked_at: revokedAt }));
  seedCatalog(db, ["drivers.view"]);

  const outcome = await loadMutationSession(db, probe("u1", revokedAt - 1));
  assert.equal(outcome.session, null);
  assert.equal(outcome.revoked, true);
});

test("demoted user loses the permission on the next page read and mutation", async () => {
  const db = createFakeDb();
  db.seed("auth_epochs/current", { access: 1, settings: 0, menu: 0 });
  db.seed("profiles/u1", staffProfile({ access_kind: "manager" }));
  seedCatalog(db, ["drivers.edit", "drivers.view", "settings.manage"]);
  const cache = createEpochCache();

  const before = await loadReadSession(db, cache, probe("u1", 1));
  assert.equal(before.session?.permissions.has("drivers.edit"), true);

  db.seed("profiles/u1", staffProfile({ access_kind: "user" }));
  db.seed("admin_user_permissions/u1", { permission_slugs: ["drivers.view"] });
  db.seed("auth_epochs/current", { access: 2, settings: 0, menu: 0 });

  const page = await loadReadSession(db, cache, probe("u1", 1));
  assert.equal(page.revoked, false);
  assert.equal(page.session?.permissions.has("drivers.edit"), false);
  assert.equal(page.session?.permissions.has("drivers.view"), true);

  const mutation = await loadMutationSession(db, probe("u1", 1), "drivers.edit");
  assert.equal(mutation.session?.permissions.has("drivers.edit"), false);
  assert.equal(mutation.denied, true);
});

test("clock skew: 3s before revoke passes reads and fails mutations", async () => {
  const revokedAt = 1_700_000_000_000;
  const authTime = revokedAt - 3_000;
  assert.equal(sessionRevokedForRead(authTime, revokedAt), false);
  assert.equal(sessionRevokedForMutation(authTime, revokedAt), true);

  const db = createFakeDb();
  db.seed("auth_epochs/current", { access: 1 });
  db.seed("profiles/u1", staffProfile({ sessions_revoked_at: revokedAt }));
  seedCatalog(db, ["drivers.view"]);

  const read = await loadReadSession(db, createEpochCache(), probe("u1", authTime));
  assert.equal(read.revoked, false);
  assert.ok(read.session);

  const mutation = await loadMutationSession(db, probe("u1", authTime));
  assert.equal(mutation.revoked, true);
  assert.equal(mutation.session, null);
});

test("re-login after revoke passes when approved and fails when archived", async () => {
  const revokedAt = 1_700_000_000_000;
  const authTime = revokedAt + 1_000;
  const db = createFakeDb();
  db.seed("auth_epochs/current", { access: 3 });
  db.seed("profiles/u1", staffProfile({ sessions_revoked_at: revokedAt, archived_at: null }));
  seedCatalog(db, ["drivers.view"]);
  const cache = createEpochCache();

  const approved = await loadReadSession(db, cache, probe("u1", authTime));
  assert.ok(approved.session);
  assert.equal(
    cache.snapshot().some((entry) => entry.id === "u1" || entry.id.includes("profiles")),
    false,
  );

  db.seed("profiles/u1", staffProfile({ sessions_revoked_at: revokedAt, archived_at: "2026-10-12T00:00:00.000Z" }));
  const archived = await loadReadSession(db, cache, probe("u1", authTime));
  assert.equal(archived.session, null);
  assert.equal(archived.revoked, false);
});

test("unclaimed settings and maintenance mode are not served from the epoch cache", async () => {
  const db = createFakeDb();
  db.seed("auth_epochs/current", { settings: 2 });
  db.seed("app_settings/1", {
    super_admin_claimed: false,
    maintenance_mode: true,
    app_name: "live",
  });
  const cache = createEpochCache();
  const live = await readEpochSettings(db, cache, null);
  assert.equal(live?.maintenance_mode, true);
  assert.equal(cache.snapshot().some((entry) => entry.kind === "settings"), false);

  db.seed("app_settings/1", {
    super_admin_claimed: true,
    maintenance_mode: true,
    app_name: "claimed",
  });
  const claimed = await readEpochSettings(db, cache, null);
  assert.equal(claimed?.maintenance_mode, true);
  const stored = cache.snapshot().find((entry) => entry.kind === "settings");
  assert.equal(stored?.doc.data?.maintenance_mode, undefined);
  assert.equal(stored?.doc.data?.app_name, "claimed");
});

test("reads do not check revocation and mutations do", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const session = fs.readFileSync(path.join(root, "src/lib/firebase/session.ts"), "utf8");
  assert.match(session, /options\.checkRevoked === true/);
  assert.match(session, /verifySessionCookie\(cookie, checkRevoked\)/);
  assert.doesNotMatch(session, /verifySessionCookie\(cookie, true\)/);

  const mutation = fs.readFileSync(path.join(root, "src/lib/auth/require-mutation-auth.ts"), "utf8");
  assert.match(mutation, /checkRevoked:\s*true/);

  for (const relative of [
    "src/lib/auth/get-session.ts",
    "src/lib/firebase/middleware.ts",
    "src/lib/firebase/callable.ts",
  ]) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.match(source, /checkRevoked:\s*false/, relative);
  }
  const callable = fs.readFileSync(path.join(root, "src/lib/firebase/callable.ts"), "utf8");
  assert.doesNotMatch(callable, /checkRevoked:\s*true/);

  const performance = fs.readFileSync(
    path.join(root, "functions/src/rpcs/performance-extra.ts"),
    "utf8",
  );
  assert.match(performance, /FieldValue\.increment/);
  assert.match(performance, /authEpochs/);
});

const ROOT = path.resolve(import.meta.dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function functionBody(source: string, name: string): string {
  const start = source.search(new RegExp(`(?:export\\s+)?async function ${name}\\b`));
  assert.ok(start >= 0, name);
  let paren = 0;
  let angle = 0;
  let brace = 0;
  let started = false;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") paren += 1;
    else if (char === ")") paren -= 1;
    else if (char === "<") angle += 1;
    else if (char === ">") angle = Math.max(0, angle - 1);
    else if (char === "{") {
      if (!started && paren === 0 && angle === 0) started = true;
      if (started) brace += 1;
    } else if (char === "}" && started) {
      brace -= 1;
      if (brace === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}

function hasFirestoreWrite(source: string): boolean {
  return source.split("\n").some((line) => {
    if (/cache\.set|maps\[|tokenCache\.set|localStorage\.set|queryClient\.set/.test(line)) {
      return false;
    }
    return (
      /(?:tx|batch)\.(?:set|delete|update)\(/.test(line) ||
      /\.ref\.(?:set|delete|update)\(/.test(line) ||
      /[Rr]ef\.(?:set|delete|update)\(/.test(line) ||
      /\)\.(?:set|delete|update)\(/.test(line)
    );
  });
}

test("epoch writers and removal paths go through the helpers", () => {
  const writerRoots = [
    "src/features/settings",
    "src/features/auth",
    "src/services",
    "src/lib/branding",
    "src/lib/auth",
  ];
  const epochCollection =
    /COLLECTIONS\.(?:adminRoles|adminRolePermissions|adminUserPermissions|appSettings|menuConfigs|adminPermissions)\b/;
  for (const relative of writerRoots) {
    for (const file of walk(path.join(ROOT, relative))) {
      if (file.endsWith(".test.ts")) continue;
      const source = fs.readFileSync(file, "utf8");
      if (!epochCollection.test(source) || !hasFirestoreWrite(source)) continue;
      assert.match(source, /writeWithEpoch/, path.relative(ROOT, file));
    }
  }

  const scans = [
    ...walk(path.join(ROOT, "src")),
    ...walk(path.join(ROOT, "functions/src")),
  ].filter((file) => !file.endsWith(".test.ts"));

  for (const file of scans) {
    const source = fs.readFileSync(file, "utf8");
    const relative = path.relative(ROOT, file);
    if (source.includes("revokeRefreshTokens") && !relative.endsWith(`${path.sep}staff-auth.ts`)) {
      assert.fail(`revokeRefreshTokens outside revokeStaffAccess: ${relative}`);
    }
    if (/approval_status:\s*["']rejected["']/.test(source) && !relative.endsWith(`${path.sep}staff-auth.ts`)) {
      assert.fail(`approval_status rejected outside revokeStaffAccess: ${relative}`);
    }
    if (/admin_role_id:\s*null\b/.test(source) && !relative.endsWith(`${path.sep}staff-auth.ts`)) {
      assert.fail(`admin_role_id null outside revokeStaffAccess: ${relative}`);
    }
    if (
      source.includes("COLLECTIONS.profiles") &&
      /archived_at:\s*new Date\(\)\.toISOString\(\)/.test(source) &&
      !relative.endsWith(`${path.sep}staff-auth.ts`)
    ) {
      assert.fail(`archived_at stamp outside revokeStaffAccess: ${relative}`);
    }
  }

  const removal: Array<[string, string]> = [
    ["src/features/settings/access-requests-actions.ts", "rejectUser"],
    ["src/features/settings/staff-access-actions.ts", "archiveStaff"],
    ["src/features/settings/staff-access-actions.ts", "removeStaffRole"],
    ["src/features/settings/staff-access-actions.ts", "saveStaffAccess"],
  ];
  for (const [relative, name] of removal) {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.match(functionBody(source, name), /revokeStaffAccess\(/, `${relative} ${name}`);
  }

  const signOut = functionBody(
    fs.readFileSync(path.join(ROOT, "src/features/auth/actions.ts"), "utf8"),
    "signOut",
  );
  assert.match(signOut, /jar\.delete\(STAFF_SESSION_COOKIE\)/);
  assert.doesNotMatch(signOut, /revokeStaffAccess\(/);
  assert.doesNotMatch(signOut, /revokeRefreshTokens\(/);
  assert.doesNotMatch(signOut, /sessions_revoked_at/);
  assert.doesNotMatch(signOut, /auth_epochs|authEpochs|writeWithEpoch/);
});

test("an epoch cache entry older than five minutes is a miss", () => {
  let now = 1_000_000;
  const cache = createEpochCache(() => now);
  const doc = { exists: true, data: { tree: ["a"] } };
  cache.set("menu", "operator", 4, doc);
  now += EPOCH_CACHE_MAX_TTL_MS - 1;
  assert.equal(cache.get("menu", "operator", 4)?.exists, true);
  now += 2;
  assert.equal(cache.get("menu", "operator", 4), undefined);

  cache.set("settings", "app", 4, doc);
  now += EPOCH_CACHE_MAX_TTL_MS + 1;
  assert.equal(cache.get("settings", "app", 4), undefined);
});

test("applyReturnedEpochs does not rewind a higher counter", () => {
  const current = { access: 3, settings: 1, menu: 2 };
  assert.deepEqual(applyReturnedEpochs(current, null), current);
  assert.deepEqual(applyReturnedEpochs(current, undefined), current);
  assert.deepEqual(
    applyReturnedEpochs(current, { menu: 5, access: 1, settings: Number.NaN }),
    { access: 3, settings: 1, menu: 5 },
  );
  assert.deepEqual(applyReturnedEpochs(current, { settings: 4 }), {
    access: 3,
    settings: 4,
    menu: 2,
  });
});

test("panel gate sends unclaimed staff to claim before pending or maintenance", () => {
  const approved = {
    hasSession: true,
    unavailable: false,
    notAuthorized: false,
    approvalStatus: "approved" as const,
    adminRoleId: "role",
    archivedAt: null,
    isSuperAdmin: false,
    unclaimedSuperAdmin: false,
    maintenanceMode: false,
  };
  assert.equal(
    panelGate({ ...approved, unclaimedSuperAdmin: true, approvalStatus: "pending" }),
    "claim",
  );
  assert.equal(panelGate({ ...approved, approvalStatus: "pending" }), "pending");
  assert.equal(panelGate({ ...approved, maintenanceMode: true }), "maintenance");
  assert.equal(panelGate({ ...approved, isSuperAdmin: true, maintenanceMode: true }), "ok");
  assert.equal(panelGate({ ...approved, hasSession: false, notAuthorized: true }), "not_authorized");
  assert.equal(panelGate({ ...approved, hasSession: false }), "login");
  assert.equal(
    panelGate({ ...approved, hasSession: false, unavailable: true }),
    "unavailable",
  );
  assert.equal(
    signedInEntryRedirect({ approval_status: "pending", admin_role_id: "role" }),
    "/pending-approval",
  );
  assert.equal(
    signedInEntryRedirect({ approval_status: "approved", admin_role_id: "role" }),
    "/dashboard",
  );
});

test("proxy verifies the cookie and does not read profiles or epochs", () => {
  const proxy = fs.readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
  assert.doesNotMatch(proxy, /readProxyGate|COLLECTIONS\.profiles|auth_epochs|authEpochs|getAppOpsSettings/);
  assert.match(proxy, /!probe\.uid && isProtectedPath/);
  const middleware = fs.readFileSync(path.join(ROOT, "src/lib/firebase/middleware.ts"), "utf8");
  assert.match(middleware, /checkRevoked:\s*false/);
  assert.doesNotMatch(middleware, /COLLECTIONS\.profiles|auth_epochs|authEpochs/);
});
