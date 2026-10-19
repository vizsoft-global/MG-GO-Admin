/**
 * Reads one rider-day straight from the FleetRoom archive (`GET /history`) without
 * stamping `location_gps_r2_since`. This is the same object the panel will read
 * after the cutover, which is what makes it a probe rather than an estimate.
 *
 *   node scripts/gps-probe-history.mjs --driver <id> --day 2026-10-19
 *   node scripts/gps-probe-history.mjs --driver <id> --list
 *
 * Env: FLEET_WS_URL, FLEET_WS_TOKEN_SECRET, FLEET_ROOM. Read-only.
 */
import { createHmac } from "node:crypto";

import { loadEnv } from "./perf-env.mjs";

const KUWAIT_OFFSET_MS = 3 * 3_600_000;

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function kuwaitToday() {
  return new Date(Date.now() + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}

const driverId = arg("driver");
if (!driverId) {
  console.error("--driver <id> is required");
  process.exit(1);
}
const day = arg("day") ?? kuwaitToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
  console.error("--day must be YYYY-MM-DD");
  process.exit(1);
}
const listDays = process.argv.includes("--list");
const archive = process.argv.includes("--archive");

const env = loadEnv();
const pick = (key) => (process.env[key] ?? env[key] ?? "").trim();
const base = pick("FLEET_WS_URL").replace(/\/+$/, "").replace(/^ws(s?):/i, "http$1:");
const secret = pick("FLEET_WS_TOKEN_SECRET");
const room = pick("FLEET_ROOM") || "fleet-kw";
if (!base || !secret) {
  console.error("FLEET_WS_URL / FLEET_WS_TOKEN_SECRET missing");
  process.exit(1);
}

function signToken() {
  const encode = (buffer) =>
    buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const body = encode(
    Buffer.from(
      JSON.stringify({ sub: "gps-probe-history", room, exp: Math.floor(Date.now() / 1000) + 60 }),
    ),
  );
  return `${body}.${encode(createHmac("sha256", secret).update(body).digest())}`;
}

async function edgeGet(path) {
  return fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${signToken()}` },
    cache: "no-store",
  });
}

function fail(status, payload) {
  if (status === 401) {
    console.error(
      "401 — the Worker rejected the token. FLEET_WS_TOKEN_SECRET must match the Worker's ADMIN_WS_TOKEN_SECRET.",
    );
  } else if (status === 409) {
    console.error("409 — day is outside the 7-day hot window; add --archive to pay the R2 retrieval.");
  } else {
    console.error(`HTTP ${status}: ${JSON.stringify(payload)}`);
  }
  process.exit(1);
}

if (listDays) {
  const response = await edgeGet(`/history/days?driver=${encodeURIComponent(driverId)}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) fail(response.status, payload);
  const days = payload?.days ?? [];
  console.log(`driver ${driverId}: ${days.length} archived day(s)`);
  console.log("day         points  distance_km  archived");
  for (const row of days) {
    console.log(
      `${row.day}  ${String(row.points).padStart(6)}  ${(Number(row.distance_m ?? 0) / 1000)
        .toFixed(2)
        .padStart(11)}  ${row.archived ? "yes" : "no"}`,
    );
  }
  process.exit(0);
}

const params = new URLSearchParams({ driver: driverId, day });
if (archive) params.set("archive", "1");
const response = await edgeGet(`/history?${params.toString()}`);
const payload = await response.json().catch(() => null);
if (!response.ok || payload?.ok === false) fail(response.status, payload);

const points = Array.isArray(payload?.points) ? payload.points : [];
console.log(`driver ${driverId}  day ${day}  points ${points.length}`);
if (points.length > 0) {
  const first = points[0];
  const last = points[points.length - 1];
  console.log(
    `first ${new Date(first.t).toISOString()}  last ${new Date(last.t).toISOString()}`,
  );
  console.log(`first_fix ${first.la},${first.lo}  last_fix ${last.la},${last.lo}`);
}
console.log("stats", JSON.stringify(payload?.stats ?? null));
const sample = points.length > 3 ? [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]] : points;
for (const point of sample) {
  console.log("point", JSON.stringify(point));
}
process.exit(0);
