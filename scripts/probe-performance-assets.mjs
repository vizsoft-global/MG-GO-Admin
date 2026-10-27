/**
 * Read-only SOP v2.0 probe: partner logos + per-rider-day shift hours.
 *
 *   node scripts/probe-performance-assets.mjs
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const DAY = process.argv[2] ?? "2026-10-26";
const COLOR_KEYS = [
  "theme_color",
  "themeColor",
  "brand_color",
  "brandColor",
  "accent",
  "accent_color",
  "color",
  "primary_color",
  "hex",
];
const HOUR_KEYS = [
  "hours",
  "worked_hours",
  "workedHours",
  "scheduled_hours",
  "scheduledHours",
  "logged_hours",
  "online_hours",
  "on_shift_hours",
];

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

function set(v) {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

function kuwaitInstant(day, hms, offsetDays) {
  const [hh, mm, ss] = String(hms).split(":").map((n) => Number(n) || 0);
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + (offsetDays || 0), hh - 3, mm, ss || 0));
}

function rosterHours(input) {
  if (!input.start || !input.end || input.end.getTime() <= input.start.getTime()) {
    return { scheduled: 0, worked: 0 };
  }
  const scheduled = Math.round((input.end.getTime() - input.start.getTime()) / 60_000);
  if (!input.checkIn) return { scheduled, worked: 0 };
  const out = input.checkOut ?? input.openUntil;
  if (!out) return { scheduled, worked: 0 };
  const from = Math.max(input.start.getTime(), input.checkIn.getTime());
  const to = Math.min(input.end.getTime(), out.getTime());
  const worked = to > from ? Math.round((to - from) / 60_000) : 0;
  return { scheduled, worked };
}

function asDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

console.log("#### A) partners");
const partners = await db.collection("partners").get();
let withLogo = 0;
let withoutLogo = 0;
const allPartnerKeys = new Set();
for (const doc of partners.docs) {
  const d = doc.data() ?? {};
  for (const k of Object.keys(d)) allPartnerKeys.add(k);
  const logo = d.logo_url ?? d.logoUrl ?? null;
  const hasLogo = set(logo);
  if (hasLogo) withLogo += 1;
  else withoutLogo += 1;
  const colors = {};
  for (const k of COLOR_KEYS) if (d[k] !== undefined) colors[k] = d[k];
  console.log(
    JSON.stringify({
      id: doc.id,
      key: d.key ?? null,
      slug: d.slug ?? null,
      name: d.name ?? null,
      logo_url_set: hasLogo,
      logo_url: hasLogo ? String(logo).slice(0, 120) : null,
      colors: Object.keys(colors).length ? colors : null,
    }),
  );
}
console.log(
  JSON.stringify({
    partner_count: partners.size,
    with_logo_url: withLogo,
    without_logo_url: withoutLogo,
    partner_field_names: [...allPartnerKeys].sort(),
  }),
);

console.log("\n#### A) source_companies (bonus)");
const companies = await db.collection("source_companies").get();
let coLogo = 0;
let coNo = 0;
for (const doc of companies.docs) {
  const d = doc.data() ?? {};
  const logo = d.logo_url ?? d.logoUrl ?? null;
  const hasLogo = set(logo);
  if (hasLogo) coLogo += 1;
  else coNo += 1;
  console.log(
    JSON.stringify({
      id: doc.id,
      key: d.key ?? null,
      name: d.name ?? null,
      logo_url_set: hasLogo,
      logo_url: hasLogo ? String(logo).slice(0, 120) : null,
    }),
  );
}
console.log(JSON.stringify({ company_count: companies.size, with_logo_url: coLogo, without_logo_url: coNo }));

console.log(`\n#### B) driver_daily_shifts shift_date=${DAY}`);
const shifts = await db.collection("driver_daily_shifts").where("shift_date", "==", DAY).get();
console.log(JSON.stringify({ docs: shifts.size }));

const samples = shifts.docs.slice(0, 10);
const hourHits = { stored: 0, windows: 0, off: 0 };
for (const doc of samples) {
  const d = doc.data() ?? {};
  const fields = Object.keys(d).sort();
  const storedHour = HOUR_KEYS.filter((k) => d[k] !== undefined && d[k] !== null);
  const hasWindow = set(d.session1_start) && set(d.session1_end);
  if (storedHour.length) hourHits.stored += 1;
  if (hasWindow) hourHits.windows += 1;
  if (d.is_off === true) hourHits.off += 1;
  console.log(
    JSON.stringify({
      id: doc.id,
      driver_id: d.driver_id ?? null,
      fields,
      stored_hour_keys: storedHour,
      session1_start: d.session1_start ?? null,
      session1_end: d.session1_end ?? null,
      session1_end_day_offset: d.session1_end_day_offset ?? null,
      session2_start: d.session2_start ?? null,
      session2_end: d.session2_end ?? null,
      is_off: d.is_off ?? null,
      source: d.source ?? null,
    }),
  );
}

const workSamples = shifts.docs.filter((doc) => doc.data()?.is_off !== true).slice(0, 5);
const overlap = [];
for (const doc of workSamples) {
  const d = doc.data() ?? {};
  const driverId = d.driver_id;
  const att = await db
    .collection("attendance_logs")
    .where("driver_id", "==", driverId)
    .where("log_date", "==", DAY)
    .get();
  let checkIn = null;
  let checkOut = null;
  const attFields = new Set();
  for (const a of att.docs) {
    const row = a.data() ?? {};
    for (const k of Object.keys(row)) attFields.add(k);
    const cin = asDate(row.check_in_at);
    const cout = asDate(row.check_out_at);
    if (cin && (!checkIn || cin < checkIn)) checkIn = cin;
    if (cout && (!checkOut || cout > checkOut)) checkOut = cout;
  }
  const startHms = d.session1_start;
  const endHms = d.session2_end || d.session1_end;
  const endOffset = d.session2_end ? Number(d.session2_end_day_offset) || 0 : Number(d.session1_end_day_offset) || 0;
  const start = startHms ? kuwaitInstant(DAY, startHms, 0) : null;
  const end = endHms ? kuwaitInstant(DAY, endHms, endOffset) : null;
  const hours = rosterHours({
    start,
    end,
    checkIn,
    checkOut,
    openUntil: checkOut ? null : new Date(),
  });
  overlap.push({
    driver_id: driverId,
    shift_id: doc.id,
    session1_start: d.session1_start ?? null,
    session1_end: d.session1_end ?? null,
    attendance_docs: att.size,
    att_fields: [...attFields].sort(),
    check_in_at: checkIn ? checkIn.toISOString() : null,
    check_out_at: checkOut ? checkOut.toISOString() : null,
    rosterHours: hours,
    computable: Boolean(start && end),
  });
}
console.log("\n#### B) rosterHours overlap on 5 work-day samples");
for (const row of overlap) console.log(JSON.stringify(row));

const windowCount = shifts.docs.filter((doc) => {
  const d = doc.data() ?? {};
  return set(d.session1_start) && set(d.session1_end);
}).length;
const storedHourCount = shifts.docs.filter((doc) => {
  const d = doc.data() ?? {};
  return HOUR_KEYS.some((k) => d[k] !== undefined && d[k] !== null);
}).length;
console.log(
  JSON.stringify({
    day: DAY,
    shift_docs: shifts.size,
    with_session_window: windowCount,
    with_stored_hours_number: storedHourCount,
    overlap_samples: overlap.length,
    overlap_computable: overlap.filter((r) => r.computable).length,
    overlap_with_attendance: overlap.filter((r) => r.attendance_docs > 0).length,
  }),
);
