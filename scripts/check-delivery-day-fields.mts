/**
 * Diagnostic: does every delivery carry `shift_date`?
 *
 * `weekDeliveryCount` can be answered with a single `count()` aggregate on
 * `shift_date` (one billed read per 1000 index entries) **only if** the two
 * range fields agree, because the old two-scan version deduped by document id
 * across `shift_date` and `delivered_day`. This measures the gap the aggregate
 * would miss, so the optimisation can be justified instead of assumed.
 *
 * Read-only: two `count()` aggregates. Run it with
 * `node --import tsx scripts/check-delivery-day-fields.mts`.
 */
import { readFileSync } from "node:fs";

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  let text = "";
  try {
    text = readFileSync(".env.local", "utf8");
  } catch {
    return out;
  }
  const pattern = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.|\r?\n)*"|'[^']*'|[^\r\n]*)/gm;
  for (const match of text.matchAll(pattern)) {
    const key = match[1];
    let raw = match[2] ?? "";
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }
    out[key] = raw.replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
  }
  return out;
}

for (const [key, value] of Object.entries(loadEnvLocal())) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const { initializeApp, cert, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { resolveFirebaseAdminCredentials } = await import("../src/lib/firebase/credentials");

const config = resolveFirebaseAdminCredentials();
if (!config) {
  console.error("no Firebase credentials in .env.local");
  process.exit(1);
}
const app = getApps()[0] ?? initializeApp({ credential: cert(config), projectId: config.projectId });
const db = getFirestore(app, "default");
const deliveries = db.collection("deliveries");

const paged = async (name: string, build: () => Promise<number>): Promise<number> => {
  const value = await build();
  console.log(`${name.padEnd(46)} ${String(value).padStart(9)}`);
  return value;
};

const total = await paged("deliveries (all)", async () =>
  (await deliveries.count().get()).data().count);
const withShift = await paged("deliveries with shift_date >= 1970-01-01", async () =>
  (await deliveries.where("shift_date", ">=", "1970-01-01").count().get()).data().count);
const withDelivered = await paged("deliveries with delivered_day >= 1970-01-01", async () =>
  (await deliveries.where("delivered_day", ">=", "1970-01-01").count().get()).data().count);

console.log(`\ngap total - withShift      ${String(total - withShift).padStart(9)}`);
console.log(`gap total - withDelivered  ${String(total - withDelivered).padStart(9)}`);
console.log(
  `\nA shift_date aggregate misses only the ${total - withShift} row(s) above.` +
    `\nIf that is 0, the aggregate is exact for the current data and the` +
    `\ntwo-scan fallback only ever runs for legacy/import rows.`,
);
process.exit(0);
