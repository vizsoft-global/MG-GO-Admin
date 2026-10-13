import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const skip = ["node_modules", ".next", ".git", "graphify-out", "deliverables"];

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

const srcFiles = walk(join(root, "src"), [".ts", ".tsx"]);
const infraFiles = [...walk(join(root, "infra"), [".ts"]), ...walk(join(root, "scripts"), [".mjs", ".ts"])];

const stats = {
  srcFiles: srcFiles.length,
  supabaseImportFiles: 0,
  firebaseImportFiles: 0,
  supabaseRpcCalls: 0,
  otherRpcCalls: 0,
  supabaseFromCalls: 0,
  pgClientFiles: 0,
  realtimeChannelCalls: 0,
  firestoreListenerCalls: 0,
  supabaseStorageCalls: 0,
  firebaseStorageCalls: 0,
};

const rpcByModule = new Map();
const supabaseFiles = new Set();

for (const f of srcFiles) {
  const src = readFileSync(f, "utf8");
  const rel = relative(root, f).replace(/\\/g, "/");
  const usesSupabaseClient = /@\/lib\/supabase|supabase\/supabase-js|@supabase\/ssr/.test(src);
  if (usesSupabaseClient) {
    stats.supabaseImportFiles += 1;
    supabaseFiles.add(rel);
  }
  if (/@\/lib\/firebase|firebase-admin|firebase\/|firestore/.test(src)) stats.firebaseImportFiles += 1;
  if (/\.rpc\(\s*[`'"][a-zA-Z0-9_]+/.test(src)) {
    for (const m of src.matchAll(/([A-Za-z0-9_$.]+)\.rpc\(\s*[`'"]([a-zA-Z0-9_]+)/g)) {
      const [, client, name] = m;
      if (/supabase|sb|db|client/i.test(client)) stats.supabaseRpcCalls += 1;
      else stats.otherRpcCalls += 1;
      rpcByModule.set(name, (rpcByModule.get(name) ?? 0) + 1);
    }
  }
  for (const m of src.matchAll(/([A-Za-z0-9_$.]+)\.from\(/g)) {
    if (m[1] === "Array" || m[1] === "Buffer" || m[1] === "Object") continue;
    stats.supabaseFromCalls += 1;
  }
  if (/supabase\s*\.\s*(channel|removeChannel)\(/.test(src)) stats.realtimeChannelCalls += 1;
  if (/onSnapshot\(/.test(src)) stats.firestoreListenerCalls += 1;
  if (/\.storage\s*\.\s*from\(/.test(src)) stats.supabaseStorageCalls += 1;
  if (/getStorage\(|firebase\/storage/.test(src)) stats.firebaseStorageCalls += 1;
  if (/@\/lib\/pg|new Pool\(|pg\b/.test(src) && /postgres|pg\b/i.test(src)) stats.pgClientFiles += 1;
}

const fnFiles = walk(join(root, "functions", "src"), [".ts"]);
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

const rpcNames = new Set(rpcByModule.keys());
const missingRpc = [...rpcNames].filter((n) => !implemented.has(n)).sort();

const pct = (a, b) => (b === 0 ? 100 : Math.round((a / b) * 1000) / 10);

console.log("== admin migration progress ==");
console.log(`src files                       ${stats.srcFiles}`);
console.log(`files importing Supabase client ${stats.supabaseImportFiles} (${pct(stats.srcFiles - stats.supabaseImportFiles, stats.srcFiles)}% off Supabase)`);
console.log(`files importing Firebase/Admin  ${stats.firebaseImportFiles}`);
console.log(`RPC names in src                ${rpcNames.size}`);
console.log(`RPC names with a function       ${rpcNames.size - missingRpc.length} (${pct(rpcNames.size - missingRpc.length, rpcNames.size)}%)`);
console.log(`RPC names still missing         ${missingRpc.length}`);
console.log(`supabase.rpc call sites         ${stats.supabaseRpcCalls}`);
console.log(`other .rpc call sites           ${stats.otherRpcCalls}`);
console.log(`supabase .from call sites       ${stats.supabaseFromCalls}`);
console.log(`supabase storage call sites     ${stats.supabaseStorageCalls}`);
console.log(`supabase realtime channel files ${stats.realtimeChannelCalls}`);
console.log(`firestore onSnapshot files      ${stats.firestoreListenerCalls}`);
console.log(`cloud function modules          ${fnFiles.length}`);
console.log("\n-- files still importing Supabase --");
console.log([...supabaseFiles].sort().join("\n"));
console.log("\n-- RPC names still missing a function --");
console.log(missingRpc.join("\n"));

// ---- second pass: surface-level choke points ---------------------------------
const rpcFiles = new Set();
const fromFiles = new Set();
const ilikeFiles = new Set();
const realtimeFiles = new Set();
for (const f of srcFiles) {
  const src = readFileSync(f, "utf8");
  const rel = relative(root, f).replace(/\\/g, "/");
  if (/\.rpc\(/.test(src)) rpcFiles.add(rel);
  if (/\.from\(/.test(src) && /@\/lib\/supabase|@supabase\//.test(src)) fromFiles.add(rel);
  if (/\.ilike\(|\.or\(|\.textSearch\(/.test(src)) ilikeFiles.add(rel);
  if (/\.channel\(|realtime/.test(src)) realtimeFiles.add(rel);
}

const cronRoutes = walk(join(root, "src", "app", "api", "cron"), [".ts"]).map((p) =>
  relative(root, p).replace(/\\/g, "/"),
);
const edgeFunctions = (() => {
  try {
    return readdirSync(join(root, "supabase", "functions"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
})();

let clientSdk = "absent";
try {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (pkg.dependencies?.firebase) clientSdk = `present (${pkg.dependencies.firebase})`;
  else if (pkg.dependencies?.["firebase/app"]) clientSdk = "present (scoped)";
} catch {}

console.log("\n== choke points ==");
console.log(`files with .rpc( calls              ${rpcFiles.size}`);
console.log(`files with supabase .from( calls    ${fromFiles.size}`);
console.log(`files with ilike/or/textSearch      ${ilikeFiles.size}`);
console.log(`files with realtime/channel         ${realtimeFiles.size}`);
console.log(`vercel cron routes                  ${cronRoutes.length}`);
console.log(`supabase edge functions             ${edgeFunctions.length} [${edgeFunctions.join(", ")}]`);
console.log(`firebase web client sdk (package)   ${clientSdk}`);
console.log("\n-- supabase edge functions --");
console.log(edgeFunctions.join("\n"));
console.log("\n-- files with ilike/or/textSearch --");
console.log([...ilikeFiles].sort().join("\n"));
console.log("\n-- files with realtime/channel --");
console.log([...realtimeFiles].sort().join("\n"));
