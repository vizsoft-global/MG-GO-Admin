import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { writeWithEpoch } from "./auth-epochs";
import { claimSuperAdminAtomic } from "./sync-profile";
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
 * Epoch writers are checked per function across src and functions/src.
 * A function that only reads app settings does not count.
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

test("first super-admin claim succeeds once and is rejected when one exists", async () => {
  const db = createFakeDb();
  db.seed("app_settings/1", { super_admin_claimed: false });
  db.seed("auth_epochs/current", { access: 4, settings: 2, menu: 1 });
  db.seed("profiles/first", { role: "staff" });

  const first = await claimSuperAdminAtomic(asFirestore(db), "first");
  assert.equal(first, true);
  assert.equal(db.read("app_settings/1")?.super_admin_claimed, true);
  assert.equal(db.read("app_settings/1")?.super_admin_user_id, "first");
  assert.equal(db.read("profiles/first")?.access_kind, "manager");
  assert.equal(db.read("auth_epochs/current")?.access, 5);
  assert.equal(db.read("auth_epochs/current")?.settings, 3);
  assert.equal(db.read("auth_epochs/current")?.menu, 1);

  const again = await claimSuperAdminAtomic(asFirestore(db), "second");
  assert.equal(again, false);
  assert.equal(db.read("app_settings/1")?.super_admin_user_id, "first");
  assert.equal(db.read("profiles/second"), undefined);
  assert.equal(db.read("auth_epochs/current")?.access, 5);
  assert.equal(db.read("auth_epochs/current")?.settings, 3);

  const taken = createFakeDb();
  taken.seed("app_settings/1", {
    super_admin_claimed: true,
    super_admin_user_id: "existing",
  });
  taken.seed("auth_epochs/current", { access: 1, settings: 1, menu: 0 });
  const rejected = await claimSuperAdminAtomic(asFirestore(taken), "other");
  assert.equal(rejected, false);
  assert.equal(taken.read("app_settings/1")?.super_admin_user_id, "existing");
  assert.equal(taken.read("auth_epochs/current")?.access, 1);
  assert.equal(taken.read("auth_epochs/current")?.settings, 1);

  const action = fs.readFileSync(path.join(ROOT, "src/features/auth/actions.ts"), "utf8");
  const body = functionBody(action, "claimSuperAdmin");
  assert.match(body, /if \(!claimed\)/);
  assert.match(body, /error: "claim_failed"/);
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
  const epochWrite = fs.readFileSync(path.join(root, "functions/src/core/epoch-write.ts"), "utf8");
  assert.match(epochWrite, /FieldValue\.increment/);
  assert.match(epochWrite, /auth_epochs/);
  assert.match(performance, /writeWithEpoch\(db,\s*"settings"/);
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

const EPOCH_SPECS = [
  { expr: "COLLECTIONS.appSettings", literal: "app_settings" },
  { expr: "COLLECTIONS.menuConfigs", literal: "menu_configs" },
  { expr: "COLLECTIONS.adminRoles", literal: "admin_roles" },
  { expr: "COLLECTIONS.adminRolePermissions", literal: "admin_role_permissions" },
  { expr: "COLLECTIONS.adminUserPermissions", literal: "admin_user_permissions" },
  { expr: "COLLECTIONS.adminPermissions", literal: "admin_permissions" },
] as const;

const EPOCH_HELPER_FILE = "functions/src/core/epoch-write.ts";

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripComments(source: string): string {
  let out = "";
  let quote: "'" | "\"" | "`" | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (quote) {
      out += char;
      if (char === "\\" && quote !== "`") {
        index += 1;
        out += source[index] ?? "";
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      index += 1;
      while (index + 1 < source.length && source[index + 1] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
      out += " ";
      continue;
    }
    out += char;
  }
  return out;
}

function epochTokens(source: string): string[] {
  const tokens = new Set<string>();
  for (const spec of EPOCH_SPECS) {
    const quoted = [`"${spec.literal}"`, `'${spec.literal}'`];
    if (!source.includes(spec.expr) && !quoted.some((literal) => source.includes(literal))) continue;
    tokens.add(spec.expr);
    for (const literal of quoted) tokens.add(literal);
  }
  const alias = /const\s+([A-Za-z0-9_]+)\s*=\s*(COLLECTIONS\.[A-Za-z0-9_]+|"[^"]+"|'[^']+')/g;
  let match: RegExpExecArray | null;
  while ((match = alias.exec(source))) {
    if (tokens.has(match[2] ?? "")) tokens.add(match[1] ?? "");
  }
  return [...tokens].filter((token) => token.length > 0);
}

type SourceFn = { name: string; body: string };

function splitTopLevelFunctions(source: string): SourceFn[] {
  const starts: Array<{ name: string; index: number }> = [];
  const re =
    /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)|^(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s+)?(?:<[^>\n]{0,120}>\s*)?(?:\(|function\b|onCall\b|onRequest\b|onSchedule\b|measureOnCall\b)/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    starts.push({ name: match[1] || match[2] || "anonymous", index: match.index });
  }
  if (starts.length === 0) return [{ name: "<module>", body: source }];
  const fns = starts.map((start, index) => ({
    name: start.name,
    body: source.slice(start.index, starts[index + 1]?.index ?? source.length),
  }));
  const preamble = source.slice(0, starts[0]?.index ?? 0);
  if (/\b(?:set|update|delete|create|patchDoc|setDoc|insertDoc|deleteDoc)\s*\(/.test(preamble)) {
    fns.unshift({ name: "<module>", body: preamble });
  }
  return fns;
}

function hasEpochHelperCall(body: string): boolean {
  return /\bwriteWithEpoch(?:Counters)?\s*\(/.test(body);
}

function rawEpochWrite(body: string, tokens: string[]): boolean {
  for (const token of tokens) {
    const t = escapeReg(token);
    if (
      new RegExp(
        `collection\\(\\s*${t}\\s*\\)\\s*\\.\\s*doc\\([\\s\\S]{0,200}?\\)\\s*\\.\\s*(?:set|update|delete|create)\\(`,
      ).test(body)
    ) {
      return true;
    }
    if (
      new RegExp(
        `\\b(?:tx|batch|transaction)\\s*\\.\\s*(?:set|update|delete|create)\\(\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)?collection\\(\\s*${t}\\s*\\)`,
      ).test(body)
    ) {
      return true;
    }
    if (new RegExp(`\\b(?:patchDoc|setDoc|insertDoc|deleteDoc)\\s*\\([\\s\\S]{0,160}?${t}`).test(body)) {
      return true;
    }
    const assign = new RegExp(
      `(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:await\\s+)?[^;]{0,500}?collection\\(\\s*${t}\\s*\\)\\s*\\.\\s*doc\\(`,
      "g",
    );
    let assigned: RegExpExecArray | null;
    while ((assigned = assign.exec(body))) {
      const name = escapeReg(assigned[1] ?? "");
      if (
        new RegExp(
          `\\b${name}\\s*\\.\\s*(?:set|update|delete|create)\\(|\\b(?:tx|batch|transaction)\\s*\\.\\s*(?:set|update|delete|create)\\(\\s*${name}\\b`,
        ).test(body)
      ) {
        return true;
      }
    }
  }
  return false;
}

function writesHelperEpochDocs(body: string, helpers: SourceFn[], tokens: string[]): boolean {
  for (const helper of helpers) {
    const touches = tokens.some((token) =>
      new RegExp(`collection\\(\\s*${escapeReg(token)}\\s*\\)`).test(helper.body),
    );
    if (!touches) continue;
    const call = new RegExp(
      `(?:const|let)\\s*(?:\\{([^}]+)\\}|([A-Za-z_]\\w*))\\s*=\\s*await\\s+${escapeReg(helper.name)}\\s*\\(`,
      "g",
    );
    let match: RegExpExecArray | null;
    while ((match = call.exec(body))) {
      const names = (match[1] ?? match[2] ?? "")
        .split(",")
        .map((part) => part.trim().split(/\s+/).pop() ?? "")
        .map((part) => (part.split(":")[0] ?? "").trim())
        .filter((name) => /^[A-Za-z_]\w*$/.test(name));
      for (const name of names) {
        const n = escapeReg(name);
        if (
          new RegExp(
            `\\b(?:tx|batch|transaction)\\s*\\.\\s*(?:set|update|delete|create)\\(\\s*${n}(?:\\[\\d+\\])?\\.ref\\b|\\b${n}(?:\\[\\d+\\])?\\.ref\\s*\\.\\s*(?:set|update|delete|create)\\(|for\\s*\\(const\\s+(\\w+)\\s+of\\s+${n}\\)[\\s\\S]{0,500}?\\b(?:tx|batch|transaction)\\s*\\.\\s*(?:set|update|delete|create)\\(\\s*\\1\\.ref\\b`,
          ).test(body)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function classifyEpochWriters(relative: string, source: string): Array<{ name: string; guarded: boolean }> {
  const posix = relative.split(path.sep).join("/");
  if (posix === EPOCH_HELPER_FILE || posix.startsWith("functions/lib/")) return [];
  if (posix.endsWith(".test.ts") || posix.endsWith(".test.tsx") || posix.endsWith(".d.ts")) return [];
  const stripped = stripComments(source);
  const tokens = epochTokens(stripped);
  if (tokens.length === 0) return [];
  const fns = splitTopLevelFunctions(stripped);
  const rows: Array<{ name: string; guarded: boolean }> = [];
  for (const fn of fns) {
    const others = fns.filter((other) => other !== fn);
    const writes = rawEpochWrite(fn.body, tokens) || writesHelperEpochDocs(fn.body, others, tokens);
    if (!writes) continue;
    rows.push({ name: fn.name, guarded: hasEpochHelperCall(fn.body) });
  }
  return rows;
}

function epochWriterMisses(relative: string, source: string): string[] {
  const posix = relative.split(path.sep).join("/");
  return classifyEpochWriters(relative, source)
    .filter((row) => !row.guarded)
    .map((row) => `${posix} ${row.name}`);
}

test("epoch writers and removal paths go through the helpers", () => {
  const misses: string[] = [];
  for (const rootName of ["src", "functions/src"]) {
    for (const file of walk(path.join(ROOT, rootName))) {
      const relative = path.relative(ROOT, file);
      if (relative.endsWith(".test.ts") || relative.endsWith(".test.tsx")) continue;
      misses.push(...epochWriterMisses(relative, fs.readFileSync(file, "utf8")));
    }
  }
  assert.deepEqual(misses, []);

  const detected = (relative: string) =>
    classifyEpochWriters(relative, fs.readFileSync(path.join(ROOT, relative), "utf8")).map((row) => row.name);
  const expectWriters: Array<[string, string[]]> = [
    ["src/features/attendance/attendance-reporting-actions.ts", ["updateAttendanceThresholdSettings"]],
    ["src/features/performance/performance-actions.ts", ["updatePerformanceScoreWeights"]],
    ["src/features/esign/esign-actions.ts", ["updateEsignScreenshotDefault"]],
    ["functions/src/rpcs/performance-extra.ts", ["adminUpdatePerformanceComponents"]],
    ["src/services/menu-config-service.ts", ["saveMenuConfig", "resetMenuConfig"]],
    ["src/features/settings/branding-actions.ts", ["writeBrandingSettings"]],
    ["src/features/settings/theme-actions.ts", ["setActiveTheme", "deleteCustomTheme"]],
    ["src/lib/auth/epoch-cache.ts", []],
  ];
  for (const [relative, names] of expectWriters) {
    assert.deepEqual(detected(relative).sort(), [...names].sort(), relative);
  }
  assert.equal(detected("src/services/menu-config-service.ts").includes("getMenuConfig"), false);
  assert.equal(detected("src/features/settings/theme-actions.ts").includes("createCustomTheme"), false);

  const scans = [
    ...walk(path.join(ROOT, "src")),
    ...walk(path.join(ROOT, "functions/src")),
  ].filter(
    (file) =>
      !file.endsWith(".test.ts") &&
      // Detector regex names revokeRefreshTokens; it does not call it.
      !file.endsWith(`${path.sep}mutation-write-scan.ts`),
  );

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
