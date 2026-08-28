/**
 * Backfills driver_performance_daily.
 *
 *   node scripts/performance-backfill.mjs                # last 90 Kuwait days
 *   node scripts/performance-backfill.mjs --days 400
 *   node scripts/performance-backfill.mjs --from 2026-01-01 --to 2026-03-31
 *
 * Chunked at a week, because the underlying read goes through v_attendance_daily
 * and a wide range exceeds every statement timeout between here and Postgres. The
 * RPC is an upsert keyed on (driver_id, log_date), so re-running a chunk replaces
 * rather than accumulates and a failed run can simply be repeated.
 *
 * What it cannot recover: speed, zone and gps come from fleet_events, which is
 * pruned on a retention cron. Days older than that window are written with those
 * columns NULL and no 'fleet_events' marker in sources_complete — never 0, which
 * would read as a perfectly compliant fleet for every day before this shipped.
 */
import { readFileSync } from "node:fs";

const CHUNK_DAYS = 7;

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : null;
};

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const at = line.indexOf("=");
      return [
        line.slice(0, at).trim(),
        line.slice(at + 1).trim().replace(/^"|"$/g, ""),
      ];
    }),
);

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  throw new Error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
}

const kuwaitToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuwait" }).format(new Date());

const addDays = (iso, delta) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};

const to = flag("to") ?? kuwaitToday();
const from =
  flag("from") ?? addDays(to, -(Number(flag("days") ?? 90) - 1));

if (from > to) throw new Error(`from ${from} is after to ${to}`);

const rebuild = async (chunkFrom, chunkTo) => {
  const res = await fetch(
    `${URL_BASE}/rest/v1/rpc/admin_rebuild_driver_performance_daily`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        apikey: KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_from: chunkFrom, p_to: chunkTo, p_driver_id: null }),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`${chunkFrom}..${chunkTo} -> ${res.status} ${text}`);
  return Number(text) || 0;
};

console.log(`Backfilling driver_performance_daily ${from} .. ${to}`);

let cursor = from;
let total = 0;
while (cursor <= to) {
  const chunkTo = addDays(cursor, CHUNK_DAYS - 1) > to ? to : addDays(cursor, CHUNK_DAYS - 1);
  const started = Date.now();
  const rows = await rebuild(cursor, chunkTo);
  total += rows;
  console.log(
    `  ${cursor} .. ${chunkTo}  ${String(rows).padStart(5)} rows  ${Date.now() - started}ms`,
  );
  cursor = addDays(chunkTo, 1);
}

console.log(`Done. ${total} driver-days written.`);
