/**
 * Times hot admin callables as the dedicated probe user.
 * Prints function names and milliseconds only. Never prints credentials or tokens.
 *
 * Requires PERF_PROBE_EMAIL and PERF_PROBE_PASSWORD in .env.local.
 * adminPerfPing 404s until that function is deployed.
 */
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

function kuwaitDay(offsetDays = 0) {
  const ms = Date.now() + 3 * 60 * 60 * 1000 + offsetDays * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
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

const day = kuwaitDay(-1);
const calls = [
  ["adminListDriversPage", { tab: "all", limit: 25, offset: 0 }],
  ["adminDriversFilterValues", { column: "status", tab: "all" }],
  ["adminDeliveriesStatusCounts", {}],
  ["adminDeliveriesCountsByFilters", {}],
  ["adminLiveFleetSnapshot", { seenWithinMinutes: 30 }],
  ["adminPerformanceOpsSnapshot", { from: day, to: day, bucket: "day" }],
  ["adminListRequests", { limit: 25, offset: 0 }],
  ["adminListAttendanceDaily", { from: day, to: day, limit: 25, offset: 0 }],
  ["adminPayrollRuleSnapshot", {}],
  ["adminPerfPing", {}],
];

const signIn = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
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
const rounds = 20;

for (const [name, data] of calls) {
  const samples = [];
  let cold = null;
  let lastStatus = "ok";
  for (let i = 0; i < rounds + 1; i += 1) {
    const started = Date.now();
    const response = await fetch(`${base}/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(180_000),
    }).catch(() => null);
    const ms = Date.now() - started;
    if (!response) {
      lastStatus = "unavailable";
      if (i === 0) cold = ms;
      else samples.push(ms);
      continue;
    }
    const body = await response.json().catch(() => null);
    const failed = !response.ok || body?.error;
    lastStatus = failed ? String(body?.error?.message ?? response.status).slice(0, 80) : "ok";
    if (name === "adminPerfPing" && response.status === 404) {
      lastStatus = "not_deployed";
      console.log(JSON.stringify({ name, status: "not_deployed" }));
      break;
    }
    if (i === 0) cold = ms;
    else samples.push(ms);
    if (failed && (response.status === 401 || response.status === 403 || lastStatus === "not_authorized")) {
      console.log(JSON.stringify({ name, status: lastStatus, coldMs: cold }));
      console.error("probe_permission=stop");
      process.exit(3);
    }
  }
  if (lastStatus === "not_deployed") continue;
  const sorted = [...samples].sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      name,
      status: lastStatus,
      coldMs: cold,
      n: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
    }),
  );
}
