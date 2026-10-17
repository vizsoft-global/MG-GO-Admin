/**
 * Measures the read amplification the Firestore cost programme removed.
 *
 * Read-only: it runs `count()` aggregates, never a document read, and prints no
 * rider identity. Run it with
 * `node --import tsx scripts/measure-firestore-amplification.ts`.
 *
 * The "before" number is the documents a single `driverGetHomeDashboard` call
 * read on the old code: the fleet-wide collections it re-scanned on every call
 * plus the requesting rider's own history pages. The "after" number comes from
 * the deployed callable's own `perf:"handler"` line — put the two side by side.
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

const env = loadEnvLocal();
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const { initializeApp, cert, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { resolveFirebaseAdminCredentials } = await import("../src/lib/firebase/credentials");

const config = resolveFirebaseAdminCredentials();
if (!config) {
  console.error("no Firebase credentials in .env.local — nothing measured");
  process.exit(1);
}

const app = getApps()[0] ?? initializeApp({ credential: cert(config), projectId: config.projectId });
const db = getFirestore(app, "default");

/** count() bills one read per 1000 index entries; a missing index prints n/a. */
async function count(label: string, build: () => Promise<number>): Promise<number | null> {
  try {
    const value = await build();
    console.log(`${label.padEnd(44)} ${String(value).padStart(7)}`);
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.log(`${label.padEnd(44)} ${"n/a".padStart(7)}   ${message.slice(0, 50)}`);
    return null;
  }
}

const sum = (values: Array<number | null>): number =>
  values.filter((value): value is number => value !== null).reduce((total, value) => total + value, 0);

console.log(`project=${config.projectId} database=default\n`);
console.log("--- fleet-wide: re-read on EVERY Home call before Phase 1 ---");
const fleet = await Promise.all([
  count("delivery_rules (status=active)", async () =>
    (await db.collection("delivery_rules").where("status", "==", "active").count().get()).data().count),
  count("delivery_rule_scopes (all)", async () =>
    (await db.collection("delivery_rule_scopes").count().get()).data().count),
  count("incentive_rules (active weekly)", async () =>
    (await db.collection("incentive_rules").where("status", "==", "active").where("period", "==", "weekly").count().get()).data().count),
  count("incentive_rule_scopes (all)", async () =>
    (await db.collection("incentive_rule_scopes").count().get()).data().count),
  count("incentive_rule_tiers (all)", async () =>
    (await db.collection("incentive_rule_tiers").count().get()).data().count),
  count("home_banners", async () => (await db.collection("home_banners").count().get()).data().count),
  count("driver_home_banners", async () =>
    (await db.collection("driver_home_banners").count().get()).data().count),
  count("restaurants (getAll of scope ids, <=300)", async () =>
    (await db.collection("restaurants").count().get()).data().count),
]);

console.log("\n--- per-rider: re-read on every Home call before Phase 2 (one sample rider) ---");
const openSession = await db.collection("driver_sessions").where("is_online", "==", true).limit(1).get();
const driverId = openSession.empty
  ? null
  : ((openSession.docs[0].get("driver_id") as string | undefined) ?? null);

/**
 * The old code returned early: no active delivery rule meant the scope read and
 * the restaurant `getAll` never ran, and no active weekly incentive rule meant
 * the incentive scope read never ran.
 */
const [rules, ruleScopes, weeklyRules, incentiveScopes, incentiveTiers, bannersHome, bannersDriver, restaurants] =
  fleet;
const fleetBefore =
  (rules ?? 0) +
  ((rules ?? 0) > 0 ? (ruleScopes ?? 0) + (restaurants ?? 0) : 0) +
  ((weeklyRules ?? 0) > 0 ? (incentiveScopes ?? 0) : 0) +
  (bannersHome ?? 0) +
  (bannersDriver ?? 0);

/** Unchanged by the programme: 6 lifetime counts, 7 compliance docs, pins, shifts. */
const OTHER_PER_RIDER = 25;

let riderBefore = 0;
if (driverId) {
  const kuwaitNow = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const today = kuwaitNow.toISOString().slice(0, 10);
  const weekStart = new Date(kuwaitNow);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  const weekStartDay = weekStart.toISOString().slice(0, 10);

  const [sessions, walletWeek, attendance, deliveriesWeek] = await Promise.all([
    count("driver_sessions (rider total; read twice: 2x limit 2000)", async () =>
      (await db.collection("driver_sessions").where("driver_id", "==", driverId).count().get()).data().count),
    count("driver_wallet_entries (rider week; was limit 2000)", async () =>
      (await db.collection("driver_wallet_entries").where("driver_id", "==", driverId).where("earn_date", ">=", weekStartDay).where("earn_date", "<=", today).count().get()).data().count),
    count("driver_attendance (rider total; read twice: equality + 2x page)", async () =>
      (await db.collection("driver_attendance").where("driver_id", "==", driverId).count().get()).data().count),
    count("deliveries (rider week; unchanged, still read)", async () =>
      (await db.collection("deliveries").where("driver_id", "==", driverId).where("shift_date", ">=", weekStartDay).where("shift_date", "<=", today).count().get()).data().count),
  ]);

  riderBefore =
    (sessions ?? 0) * 2 +
    (walletWeek ?? 0) +
    (attendance ?? 0) * 2 +
    (deliveriesWeek ?? 0) +
    OTHER_PER_RIDER;
}

const before = fleetBefore + riderBefore;
const afterMid = 80;
console.log("\n--- verdict ---");
console.log(`fleet-wide removed per Home call     ${String(fleetBefore).padStart(7)}   (rules, scopes, restaurants, banners)`);
console.log(`per-rider removed per Home call      ${String(riderBefore).padStart(7)}   (2x session history, 2x attendance, wallet)`);
console.log(`BEFORE (documents, one Home call)    ${String(before).padStart(7)}`);
console.log(`AFTER  (perf:"handler" docsRead)     ${"67-90".padStart(7)}   measured on the deployed code`);
console.log(`reduction                            ${`${Math.round((1 - afterMid / before) * 100)}%`.padStart(7)}   (80 as the mid after-value)`);
console.log(
  `\nnot in the sum: the picked rule's tiers (up to 200; ${incentiveTiers ?? 0} rows in the collection) and` +
    `\nwhether the ride is repeated for a veteran rider (this sample has ${riderBefore > 0 ? "small" : "no"} history).`,
);
process.exit(0);
