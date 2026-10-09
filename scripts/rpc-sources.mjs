/**
 * Source map for the unported admin RPCs.
 *
 * Prints, per RPC name, the newest `CREATE OR REPLACE FUNCTION public.<name>`
 * body: file, line span, size, and the guards it depends on (RLS helper calls,
 * PostGIS, dblink) plus every RAISE code it can return. Sizing the ports off the
 * SQL is the only way to plan a batch without reading 398 migrations by hand.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const migrations = join(root, "supabase", "migrations");
const files = readdirSync(migrations)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/** The names the panel still calls `.rpc("<name>")` with. */
const wanted = new Set(process.argv.slice(2));
if (wanted.size === 0) {
  console.error("usage: node scripts/rpc-sources.mjs <rpc_name> [more...]");
  process.exit(1);
}

/** name -> newest definition, because a later migration replaces an earlier body. */
const found = new Map();

/** A dollar-quote terminator: `$$;`, `$function$`, `$_$;` — any tag pg_dump used. */
const TERMINATOR = /^\$[A-Za-z_]*\$\s*;?\s*$/;
const DOLLAR_TAG = /\$[A-Za-z_]*\$/g;

for (const file of files) {
  const text = readFileSync(join(migrations, file), "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = /CREATE (?:OR REPLACE )?FUNCTION public\.([a-z0-9_]+)\(/.exec(lines[i]);
    if (!match) continue;
    const name = match[1];
    if (!wanted.has(name)) continue;
    const inline = (lines[i].match(DOLLAR_TAG) ?? []).length >= 2;
    let end = i;
    if (!inline) {
      for (let j = i + 1; j < lines.length; j += 1) {
        if (TERMINATOR.test(lines[j])) {
          end = j;
          break;
        }
      }
    }
    // A later migration replaces an earlier body, so keep the newest definition.
    found.set(name, { name, file, start: i + 1, end: end + 1, lines: end - i + 1 });
  }
}

const rows = [];
for (const name of wanted) {
  const hit = found.get(name);
  if (!hit) {
    rows.push({ name, missing: true });
    continue;
  }
  const text = readFileSync(join(migrations, hit.file), "utf8").split(/\r?\n/);
  const body = text.slice(hit.start - 1, hit.end).join("\n");
  const raises = [...new Set([...body.matchAll(/RAISE EXCEPTION '([a-z_]+)/g)].map((m) => m[1]))];
  rows.push({
    ...hit,
    isPanelUser: /is_admin_panel_user\(\)/.test(body),
    payrollManage: /payroll_can_manage\(\)/.test(body),
    superAdmin: /is_super_admin_user\(\)/.test(body),
    authUid: /auth\.uid\(\)/.test(body),
    postgis: /\bST_[A-Za-z]/.test(body),
    dblink: /dblink/.test(body),
    securityDefiner: /SECURITY DEFINER/.test(body),
    raises,
  });
}

rows.sort((a, b) => (a.lines ?? 0) - (b.lines ?? 0));
for (const row of rows) {
  if (row.missing) {
    console.log(`?? ${row.name}  (no CREATE OR REPLACE FUNCTION in migrations)`);
    continue;
  }
  const flags = [
    row.isPanelUser ? "panel" : "",
    row.payrollManage ? "payroll.manage" : "",
    row.superAdmin ? "super" : "",
    row.authUid ? "auth.uid" : "",
    row.postgis ? "POSTGIS" : "",
    row.dblink ? "DBLINK" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const rel = relative(root, join(migrations, row.file)).replace(/\\/g, "/");
  console.log(
    `${String(row.lines).padStart(4)}L  ${row.name}\n      ${rel}:${row.start}-${row.end}  [${flags}]\n      raises: ${row.raises.join(", ") || "—"}`,
  );
}
console.log(`\nresolved ${rows.filter((r) => !r.missing).length}/${rows.length}`);
