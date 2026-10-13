import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function walk(dir, exts, skip = []) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (skip.some((s) => p.includes(s))) continue;
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, exts, skip));
    else if (exts.some((e) => entry.endsWith(e))) out.push(p);
  }
  return out;
}

const adminFiles = walk(join(root, "src"), [".ts", ".tsx"], ["node_modules", ".next"]);
const rpcNames = new Set();
for (const f of adminFiles) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\.rpc\(\s*[`'"]([a-zA-Z0-9_]+)/g)) rpcNames.add(m[1]);
}

const fnFiles = walk(join(root, "functions", "src", "rpcs"), [".ts"]);
const implemented = new Set();
for (const f of fnFiles) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/export const ([A-Za-z0-9_]+)/g)) {
    implemented.add(m[1]);
    implemented.add(
      m[1].replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase(),
    );
  }
}

const missing = [...rpcNames].filter((n) => !implemented.has(n)).sort();
console.log("admin rpc names:", rpcNames.size);
console.log("implemented module functions:", fnFiles.length);
console.log("implemented consts:", new Set([...implemented].filter((s) => s.includes("_") || /[A-Z]/.test(s))).size);
console.log("missing:", missing.length);
console.log(missing.join("\n"));
