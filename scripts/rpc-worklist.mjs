/**
 * Rewire worklist: the panel's `.rpc("<name>")` call sites that already have a
 * ported Cloud Function, and therefore can move off Supabase right now.
 *
 * Prints one line per call site so a batch of rewires can be done and reviewed
 * without searching 1437 files by hand, plus the names that have a function but
 * no call site left (dead ports) and the names still waiting on a port.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
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
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/export const ([A-Za-z0-9_]+)/g)) {
    implemented.add(m[1]);
    implemented.add(snake(m[1]));
  }
}

const sites = [];
for (const f of walk(join(root, "src"), [".ts", ".tsx"])) {
  const rel = relative(root, f).replace(/\\/g, "/");
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = /\.rpc\(\s*[`'"]([a-zA-Z0-9_]+)/.exec(line);
    if (!match) return;
    sites.push({ rel, line: index + 1, name: match[1], ported: implemented.has(match[1]) });
  });
}

const ready = sites.filter((s) => s.ported);
const pending = sites.filter((s) => !s.ported);
const calledNames = new Set(sites.map((s) => s.name));
const dead = [...implemented].filter((n) => n.includes("_") && !calledNames.has(n));

console.log(`call sites: ${sites.length}  rewireable now: ${ready.length}  waiting on a port: ${pending.length}`);
console.log(`\n-- READY TO REWIRE (function exists) --`);
for (const site of ready.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line)) {
  console.log(`${site.rel}:${site.line}  ${site.name}`);
}
console.log(`\n-- ported but no call site (dead port) --`);
console.log(dead.sort().join("\n") || "—");
console.log(`\n-- still Supabase-only, needs a port --`);
const byName = new Map();
for (const site of pending) byName.set(site.name, (byName.get(site.name) ?? 0) + 1);
for (const [name, count] of [...byName].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(3)}  ${name}`);
}
