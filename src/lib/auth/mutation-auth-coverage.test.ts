import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { mutationAuthAllowReason } from "./mutation-auth-allowlist";
import {
  bodyCallsMutatingRpc,
  functionHasWrite,
  functionIsGated,
  splitTopLevelFunctions,
  type ScannedFn,
} from "./mutation-write-scan";
import { isMutatingAdminRpc } from "../firebase/mutating-rpc";

const ROOT = process.cwd();

function gated(source: string, name: string): boolean {
  const fns = splitTopLevelFunctions(source);
  const fn = fns.find((item) => item.name === name);
  assert.ok(fn, `missing ${name}`);
  return functionIsGated(fn, new Map(fns.map((item) => [item.name, item])));
}

function writes(source: string, name: string): boolean {
  const fn = splitTopLevelFunctions(source).find((item) => item.name === name);
  assert.ok(fn, `missing ${name}`);
  return functionHasWrite(fn.maskedBody);
}

test("write detector ignores maps, cookies, crypto, and comments", () => {
  const source = `
    async function txWrite() { await tx.set(ref, {}); }
    async function mapWrite() { map.set("a", 1); }
    async function constructedMap() { new Map().set("a", 1); }
    async function paramsWrite() { new URLSearchParams().set("a", "b"); }
    async function cookieWrite() { (await cookies()).set("a", "b"); }
    async function hmacWrite() { createHmac("sha256", "k").update("body"); }
    async function refWrite() { await profileRef.update({}); }
    async function docWrite() {
      await db.collection("drivers").doc(id).set({ name });
    }
    async function assignedWrite() {
      const created = db.collection("verifications").doc();
      await created.set({ ok: true });
    }
    async function sliceWrite() {
      const slice = db.batch();
      slice.set(ref, { ok: true });
    }
    async function selectOnly() {
      await db.from("drivers").select("id").eq("id", id);
    }
    async function fromUpdate() {
      await db.from("drivers").eq("id", id).update({ name });
    }
    async function fromInsert() {
      await db.from("driver_intake_restaurants").insert(rows);
    }
    async function commented() {
      // tx.set(ref, {})
      const label = "tx.set";
    }
    async function authWrite() { await auth.createUser({ uid }); }
    async function jarWrite() { jar.set(STAFF_SESSION_COOKIE, cookie, options); }
    async function eventBatchWrite() { eventBatch.delete(doc.ref); }
    async function batchesNotWrite() { batches.set(0, row); }
    async function bulkWrite() { const writer = db.bulkWriter(); }
    function outer() {
      function nested() { tx.set(ref, {}); }
      return nested();
    }
  `;
  assert.equal(writes(source, "txWrite"), true);
  assert.equal(writes(source, "mapWrite"), false);
  assert.equal(writes(source, "constructedMap"), false);
  assert.equal(writes(source, "paramsWrite"), false);
  assert.equal(writes(source, "cookieWrite"), false);
  assert.equal(writes(source, "hmacWrite"), false);
  assert.equal(writes(source, "refWrite"), true);
  assert.equal(writes(source, "docWrite"), true);
  assert.equal(writes(source, "assignedWrite"), true);
  assert.equal(writes(source, "sliceWrite"), true);
  assert.equal(writes(source, "selectOnly"), false);
  assert.equal(writes(source, "fromUpdate"), true);
  assert.equal(writes(source, "fromInsert"), true);
  assert.equal(writes(source, "commented"), false);
  assert.equal(writes(source, "authWrite"), true);
  assert.equal(writes(source, "jarWrite"), false);
  assert.equal(writes(source, "eventBatchWrite"), true);
  assert.equal(writes(source, "batchesNotWrite"), false);
  assert.equal(writes(source, "bulkWrite"), true);
  const names = splitTopLevelFunctions(source).map((fn) => fn.name);
  assert.equal(names.includes("nested"), false);
  assert.equal(writes(source, "outer"), true);
});

test("one same-file call is enough for the gate", () => {
  const source = `
    async function requireManage() {
      const auth = await requireMutationAuth("settings.manage");
      if ("error" in auth) return { error: auth.error };
      return { db: auth.session };
    }
    async function saveTheme() {
      const auth = await requireManage();
      if ("error" in auth) return auth;
      await tx.set(ref, {});
    }
    async function ungated() {
      await tx.set(ref, {});
    }
  `;
  assert.equal(gated(source, "saveTheme"), true);
  assert.equal(gated(source, "requireManage"), true);
  assert.equal(gated(source, "ungated"), false);
});

test("return types and generics still split the function", () => {
  const source = `
    export async function save<T>(input: T): Promise<{ error?: string }> {
      await db.collection("rows").doc(input.id).set(input);
    }
    export const apply = async (rows: string[]): Promise<{ error?: string }> => {
      const slice = db.batch();
      slice.set(ref, { rows });
    };
  `;
  const fns = splitTopLevelFunctions(source);
  assert.deepEqual(fns.map((fn) => fn.name), ["save", "apply"]);
  assert.equal(functionHasWrite(fns[0]?.maskedBody ?? ""), true);
  assert.equal(functionHasWrite(fns[1]?.maskedBody ?? ""), true);
});

test("isMutatingAdminRpc treats write verbs as mutations and reads as reads", () => {
  assert.equal(isMutatingAdminRpc("admin_set_driver"), true);
  assert.equal(isMutatingAdminRpc("adminUpsertRestaurant"), true);
  assert.equal(isMutatingAdminRpc("esignComposeSignedDocument"), true);
  assert.equal(isMutatingAdminRpc("driver_check_in"), true);
  assert.equal(isMutatingAdminRpc("admin_run_attendance_auto_checkout"), true);
  assert.equal(isMutatingAdminRpc("adminListDrivers"), false);
  assert.equal(isMutatingAdminRpc("admin_get_driver"), false);
  assert.equal(isMutatingAdminRpc("admin_settings"), false);
  assert.equal(isMutatingAdminRpc("admin_purge_preview"), false);
  assert.equal(isMutatingAdminRpc("admin_mark_read"), false);
  assert.equal(isMutatingAdminRpc("admin_decide_request"), true);
  assert.equal(isMutatingAdminRpc("admin_insert_delivery_rule_with_scope"), true);
  assert.equal(isMutatingAdminRpc("recalculate_driver_earnings"), true);
  assert.equal(isMutatingAdminRpc("void_payout_run"), true);
  assert.equal(isMutatingAdminRpc("admin_submit_esign_signature"), true);
  assert.equal(isMutatingAdminRpc("admin_esign_reminder_state"), false);
  assert.equal(isMutatingAdminRpc("admin_purge_filter_columns"), false);
  assert.equal(isMutatingAdminRpc("admin_bulk_get"), false);
  assert.equal(isMutatingAdminRpc("admin_performance_ops_snapshot"), false);
  assert.equal(isMutatingAdminRpc("report_delivery_orders"), false);
});

test("callAdminFunction gates mutations and callCronFunction does not", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/lib/firebase/callable.ts"), "utf8");
  const fns = splitTopLevelFunctions(source);
  const admin = fns.find((fn) => fn.name === "callAdminFunction");
  const cron = fns.find((fn) => fn.name === "callCronFunction");
  assert.ok(admin);
  assert.ok(cron);
  assert.equal(admin.body.includes("requireMutationAuth"), true);
  assert.equal(admin.body.includes("isMutatingAdminRpc"), true);
  assert.equal(cron.body.includes("requireMutationAuth"), false);
  const authAt = admin.body.indexOf("requireMutationAuth");
  const mintAt = admin.body.indexOf("mintIdToken");
  assert.equal(authAt >= 0 && mintAt > authAt, true);
});

test("signOut only clears the session cookie", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/features/auth/actions.ts"), "utf8");
  const signOut = splitTopLevelFunctions(source).find((fn) => fn.name === "signOut");
  assert.ok(signOut);
  for (const banned of [
    "requireMutationAuth",
    "revokeStaffAccess",
    "revokeRefreshTokens",
    "sessions_revoked_at",
    "writeWithEpoch",
  ]) {
    assert.equal(signOut.body.includes(banned), false, banned);
  }
});

function inScope(rel: string, source: string): boolean {
  if (rel.startsWith("src/app/api/") && rel.endsWith("/route.ts")) return true;
  return source.split(/\r?\n/).some((line) => /^\s*['"]use server['"];?\s*$/.test(line));
}

function walk(dir: string, acc: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) acc.push(full);
  }
}

export function ungatedWriteFunctions(root = ROOT): string[] {
  const files: string[] = [];
  walk(path.join(root, "src"), files);
  const misses: string[] = [];
  for (const full of files) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    const source = fs.readFileSync(full, "utf8");
    if (!inScope(rel, source)) continue;
    const fns = splitTopLevelFunctions(source);
    const byName = new Map<string, ScannedFn>(fns.map((fn) => [fn.name, fn]));
    for (const fn of fns) {
      if (!functionHasWrite(fn.maskedBody)) continue;
      if (mutationAuthAllowReason(rel, fn.name)) continue;
      if (functionIsGated(fn, byName)) continue;
      misses.push(`${rel} ${fn.name}`);
    }
  }
  return misses;
}

test("the eleven revoked-session writes call requireMutationAuth in the action", () => {
  const cases = [
    ["src/features/attendance/attendance-actions.ts", "correctAttendanceLog"],
    ["src/features/drivers/drivers-actions.ts", "restoreDriverIntake"],
    ["src/features/drivers/drivers-actions.ts", "regenerateDriverPasscode"],
    ["src/features/drivers/drivers-actions.ts", "forceSignOutDriver"],
    ["src/features/payroll/payroll-actions.ts", "recomputePayrollZoneMetrics"],
    ["src/features/notifications/notifications-actions.ts", "enqueueNotificationAutomationEvent"],
    ["src/features/assets/assets-actions.ts", "adjustAssetStock"],
    ["src/features/assets/assets-actions.ts", "returnAssetAssignment"],
    ["src/features/settings/ui-preferences-actions.ts", "clearUserUiPreference"],
    ["src/features/vehicles/vehicle-tabs-actions.ts", "assignVehicleAsset"],
    ["src/features/verifications/verifications-actions.ts", "revertImportBatch"],
  ] as const;
  for (const [rel, name] of cases) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const fns = splitTopLevelFunctions(source);
    const fn = fns.find((item) => item.name === name);
    assert.ok(fn, name);
    assert.equal(fn.body.includes("requireMutationAuth"), true, name);
    const byName = new Map(fns.map((item) => [item.name, item]));
    assert.equal(functionIsGated(fn, byName), true, name);
    assert.equal(functionHasWrite(fn.maskedBody) || bodyCallsMutatingRpc(fn.body), true, name);
  }
});

test("every in-scope write calls requireMutationAuth or is allowlisted", () => {
  const misses = ungatedWriteFunctions();
  assert.equal(misses.length, 0, misses.join("\n"));
});
