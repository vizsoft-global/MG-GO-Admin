/**
 * Codemod: move `.rpc("<name>")` call sites from the Supabase client to
 * `callAdminFunction` — but only where that substitution is provably safe.
 *
 * A site is rewired only when ALL of these hold:
 *   * the name is `admin_*` and a Cloud Function for it exists in
 *     `functions/src/rpcs` (a `driver_*` / `record_*` name may be called by the
 *     rider app with a rider token, which this bridge does not mint);
 *   * the file is server-side — it imports the server or admin Supabase client
 *     and is not a `"use client"` module, because `callable.ts` is `server-only`;
 *   * after the rewrite the file no longer mentions `supabase` at all, so the
 *     client creation and its import can be dropped with no leftover.
 *
 * Anything else is reported as MANUAL instead of being guessed at.
 *
 * Usage: node scripts/rewire-rpcs.mjs [--write]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const write = process.argv.includes("--write");
const skip = ["node_modules", ".next", ".git"];

function walk(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (skip.some((s) => p.includes(s))) continue;
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(p);
  }
  return out;
}

const snake = (name) =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase();

const implemented = new Set();
for (const f of walk(join(root, "functions", "src", "rpcs"), [".ts"])) {
  for (const m of readFileSync(f, "utf8").matchAll(/export const ([A-Za-z0-9_]+)/g)) {
    implemented.add(m[1]);
    implemented.add(snake(m[1]));
  }
}

const IMPORT_LINE = 'import { callAdminFunction } from "@/lib/firebase/callable";';
const SUPABASE_IMPORT = /^\s*import[^;]*from\s+"@\/lib\/supabase\/(server|admin|client)";\s*$/;
const CLIENT_CREATION =
  /^\s*const\s+\w+\s*=\s*\(?\s*(await\s+)?(createClient|createAdminClient)\([^)]*\)\s*\)?\s*(as\s+unknown\s+as\s+LooseRpc)?\s*;\s*$/;

const changed = [];
const manual = [];

for (const file of walk(join(root, "src"), [".ts", ".tsx"])) {
  const rel = relative(root, file).replace(/\\/g, "/");
  const original = readFileSync(file, "utf8");
  const sites = [...original.matchAll(/\.rpc\(\s*[`'"]([a-zA-Z0-9_]+)/g)].map((m) => m[1]);
  if (sites.length === 0) continue;

  const isClientModule = /^\s*["']use client["']/m.test(original);
  const importsServerClient = /from\s+"@\/lib\/supabase\/(server|admin)"/.test(original);
  const onlyAdminRpc = sites.every((name) => name.startsWith("admin_") && implemented.has(name));

  if (!onlyAdminRpc || isClientModule || !importsServerClient) {
    manual.push({
      rel,
      reason: !onlyAdminRpc
        ? `not all admin_*+ported (${sites.join(", ")})`
        : isClientModule
          ? "client module"
          : "no server supabase import",
      sites: sites.length,
    });
    continue;
  }

  // The rewrite itself: the call moves to the bridge.
  const withCalls = original.replace(/\.rpc\(\s*([`'"])/g, (_m, quote) => `callAdminFunction(${quote}`);
  const withoutClient = withCalls
    .split(/\r?\n/)
    .filter((line) => !CLIENT_CREATION.test(line))
    .join("\n");

  // Only drop the Supabase import when nothing in the file uses the client any
  // more; otherwise the two systems share the file and it needs a human.
  const withoutImport = withoutClient
    .split(/\r?\n/)
    .filter((line) => !SUPABASE_IMPORT.test(line))
    .join("\n");

  if (/\bsupabase\b/.test(withoutImport)) {
    manual.push({ rel, reason: "supabase still used elsewhere in the file", sites: sites.length });
    continue;
  }

  const lines = withoutImport.split(/\r?\n/);
  let lastImport = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^import\s/.test(lines[i])) lastImport = i;
    else if (lastImport >= 0 && lines[i].trim() !== "") break;
  }
  if (!withoutImport.includes(IMPORT_LINE) && lastImport >= 0) {
    lines.splice(lastImport + 1, 0, IMPORT_LINE);
  }

  changed.push({ rel, sites: sites.length, after: lines.join("\n") });
}

console.log(`${write ? "WRITING" : "DRY RUN"} — ${changed.length} files, ${manual.length} need a manual pass\n`);
for (const entry of changed.sort((a, b) => b.sites - a.sites)) {
  console.log(`  ${String(entry.sites).padStart(2)} sites  ${entry.rel}`);
  if (write) writeFileSync(join(root, entry.rel), entry.after, "utf8");
}
console.log("\n-- manual --");
for (const entry of manual.sort((a, b) => b.sites - a.sites)) {
  console.log(`  ${String(entry.sites).padStart(2)} sites  ${entry.rel}  (${entry.reason})`);
}
