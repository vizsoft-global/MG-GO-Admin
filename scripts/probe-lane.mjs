/**
 * Compares adminListDriversPage on the scan lane with the legacy callable.
 * Prints milliseconds and status only. Never prints credentials or tokens.
 * This script does not deploy.
 *
 * Requires PERF_PROBE_EMAIL and PERF_PROBE_PASSWORD in .env.local.
 * Run only after adminApiScan exists. Client timeout is 60s. Samples alternate.
 */
import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);

const PAGE = { tab: "all", limit: 25, offset: 0 };
const SAMPLES = 10;
const TIMEOUT_MS = 120_000;

function kuwaitDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuwait" }).format(new Date());
}

function scanCases() {
  const today = kuwaitDay();
  const month = today.slice(0, 7);
  const monthStart = `${month}-01`;
  return [
    { name: "adminPerformanceOpsSnapshot", lane: "adminApiScan", data: { from: monthStart, to: today, bucket: "day" } },
    { name: "adminLiveFleetSnapshot", lane: "adminApiScan", data: { seenWithinMinutes: 30 } },
    { name: "adminPayrollRuleSnapshot", lane: "adminApiScan", data: { month } },
    { name: "adminListAttendanceDaily", lane: "adminApiScan", data: { from: monthStart, to: today, limit: 50, offset: 0 } },
    { name: "adminDriversFilterValues", lane: "adminApiScan", data: { column: "zone", tab: "all" } },
    { name: "adminListRequests", lane: "adminApiScan", data: { limit: 25, offset: 0 } },
  ];
}

const env = loadEnv();
const account = loadServiceAccount(env);
assertProd(account);
const apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
const email = env.PERF_PROBE_EMAIL?.trim();
const password = env.PERF_PROBE_PASSWORD?.trim();
if (!apiKey || !email || !password) {
  console.error("probe_credentials=missing");
  process.exit(2);
}

const signIn = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
    signal: AbortSignal.timeout(20_000),
  },
);
if (!signIn.ok) {
  console.error("probe_sign_in=failed");
  process.exit(2);
}
const signed = await signIn.json();
const idToken = signed.idToken;
if (!idToken) {
  console.error("probe_sign_in=failed");
  process.exit(2);
}

const region = env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION?.trim() || "me-central1";
const base = `https://${region}-${account.projectId}.cloudfunctions.net`;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

async function callOnce(url, body) {
  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  const ms = Date.now() - started;
  if (!response) return { ms, status: "unavailable" };
  const payload = await response.json().catch(() => null);
  const failed = !response.ok || payload?.error;
  const status = failed
    ? String(payload?.error?.message ?? payload?.error?.status ?? response.status).slice(0, 80)
    : "ok";
  return { ms, status };
}

function shiftDay(ymd, days) {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function groupCases(which) {
  const today = kuwaitDay();
  const month = today.slice(0, 7);
  const day = shiftDay(today, -1);
  const weekFrom = shiftDay(today, -6);
  const light = [
    { name: "adminListRequests", lane: "adminApi", data: { limit: 25, offset: 0 } },
    { name: "adminPerfPing", lane: "adminApi", data: {} },
  ];
  const scan = [
    { name: "adminListDriversPage", lane: "adminApiScan", data: PAGE },
    { name: "adminDriversFilterValues", lane: "adminApiScan", data: { column: "zone", tab: "all" } },
    { name: "adminDeliveriesStatusCounts", lane: "adminApiScan", data: {} },
    { name: "adminDeliveriesCountsByFilters", lane: "adminApiScan", data: {} },
    { name: "adminLiveFleetSnapshot", lane: "adminApiScan", data: { seenWithinMinutes: 30 } },
    { name: "adminPerformanceOpsSnapshot", lane: "adminApiScan", data: { from: day, to: day, bucket: "day" } },
    {
      name: "adminListAttendanceDaily",
      lane: "adminApiScan",
      data: { from: weekFrom, to: today, limit: 50, offset: 0 },
    },
    { name: "adminPayrollRuleSnapshot", lane: "adminApiScan", data: { month } },
  ];
  const heavy = [{ name: "adminPurgeFilterColumns", lane: "adminApiHeavy", data: { entity: "drivers" } }];
  if (which === "light") return light;
  if (which === "scan") return scan;
  if (which === "heavy") return heavy;
  return [...light, ...scan, ...heavy];
}

const mode = process.argv[2] ?? "drivers";
const today = kuwaitDay();
const oneName = process.argv[3] ?? "";
const onePayloads = {
  adminPayrollRuleSnapshot: { lane: "adminApiScan", data: { month: today.slice(0, 7) } },
  adminAttendanceKpis: { lane: "adminApiScan", data: { date: today } },
  adminListDriversPage: { lane: "adminApiScan", data: PAGE },
  adminBulkUpdateDeliveries: { lane: "adminBulkUpdateDeliveries", data: { status: "verified", ids: [] } },
};
const cases = mode === "full"
  ? [
      ...groupCases("lanes").map((item) =>
        item.name === "adminPerformanceOpsSnapshot" ? { ...item, tag: "1d" } : item,
      ),
      {
        name: "adminPerformanceOpsSnapshot",
        lane: "adminApiScan",
        tag: "7d",
        data: { from: shiftDay(today, -6), to: today, bucket: "day" },
      },
      {
        name: "adminPerformanceOpsSnapshot",
        lane: "adminApiScan",
        tag: "30d",
        data: { from: shiftDay(today, -29), to: today, bucket: "day" },
      },
      { name: "adminAttendanceKpis", lane: "adminApiScan", data: { date: today } },
      { name: "adminPayrollMonthSnapshot", lane: "adminApiScan", data: { month: today.slice(0, 7) } },
      {
        name: "adminIncentiveDailyReport",
        lane: "adminApiScan",
        data: { from: shiftDay(today, -1), to: shiftDay(today, -1) },
      },
    ]
  : mode === "one" && onePayloads[oneName]
  ? [{ name: oneName, lane: onePayloads[oneName].lane, data: onePayloads[oneName].data }]
  :
  mode === "scan"
    ? scanCases()
    : mode === "attendance"
      ? [
          {
            name: "adminListAttendanceDaily",
            lane: "adminApiScan",
            data: { from: shiftDay(today, -6), to: today, limit: 50, offset: 0 },
          },
        ]
      : mode === "light"
        ? [
            { name: "adminListRequests", lane: "adminApi", data: { limit: 25, offset: 0 } },
            {
              name: "adminListAttendanceDaily",
              lane: "adminApi",
              data: { from: shiftDay(today, -6), to: today, limit: 50, offset: 0 },
            },
            { name: "adminDriversFilterValues", lane: "adminApi", data: { column: "zone", tab: "all" } },
          ]
        : mode === "group-light"
          ? groupCases("light")
          : mode === "group-scan"
            ? groupCases("scan")
  : mode === "group-heavy"
          ? groupCases("heavy")
          : mode === "group-by"
            ? [
                { name: "adminListDriversPage", lane: "adminApiScan", tag: "none", data: PAGE },
                {
                  name: "adminListDriversPage",
                  lane: "adminApiScan",
                  tag: "zone",
                  data: { ...PAGE, groupBy: "zone" },
                },
                {
                  name: "adminListDriversPage",
                  lane: "adminApiScan",
                  tag: "employeeStatus",
                  data: { ...PAGE, groupBy: "employeeStatus" },
                },
              ]
          : [{ name: "adminListDriversPage", lane: "adminApiScan", data: PAGE }];

for (const item of cases) {
  const laneTarget = {
    name: item.lane,
    url: `${base}/${item.lane}`,
    body: item.lane === item.name ? { data: item.data } : { data: { fn: item.name, data: item.data } },
  };
  const targets = mode === "full" || item.lane === item.name
    ? [laneTarget]
    : [
        laneTarget,
        {
          name: item.name,
          url: `${base}/${item.name}`,
          body: { data: item.data },
        },
      ];
  const samples = { [item.lane]: [], [item.name]: [] };
  for (let i = 0; i < SAMPLES; i += 1) {
    for (const target of targets) {
      const result = await callOnce(target.url, target.body);
      samples[target.name].push(result);
      console.log(JSON.stringify({ fn: item.name, tag: item.tag ?? null, name: target.name, i, ms: result.ms, status: result.status }));
    }
  }
  for (const target of targets) {
    const ok = samples[target.name]
      .filter((sample) => sample.status === "ok")
      .map((sample) => sample.ms)
      .sort((a, b) => a - b);
    const fails = samples[target.name].filter((sample) => sample.status !== "ok").map((sample) => sample.status);
    console.log(
      JSON.stringify({
        fn: item.name,
        tag: item.tag ?? null,
        name: target.name,
        n: samples[target.name].length,
        ok: ok.length,
        p50: percentile(ok, 50),
        p95: percentile(ok, 95),
        fail: fails[0] ?? null,
      }),
    );
  }
}
