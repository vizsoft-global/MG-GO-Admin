/**
 * Compares adminListDriversPage on the scan lane with the legacy callable.
 * Prints milliseconds and status only. Never prints credentials or tokens.
 * This script does not deploy.
 *
 * Requires PERF_PROBE_EMAIL and PERF_PROBE_PASSWORD in .env.local.
 * Run only after adminApiScan exists. Client timeout is 60s. Samples alternate.
 */
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const PAGE = { tab: "all", limit: 25, offset: 0 };
const SAMPLES = 10;
const TIMEOUT_MS = 60_000;

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
  const status = failed ? String(payload?.error?.status ?? payload?.error?.message ?? response.status).slice(0, 80) : "ok";
  return { ms, status };
}

const targets = [
  {
    name: "adminApiScan",
    url: `${base}/adminApiScan`,
    body: { data: { fn: "adminListDriversPage", data: PAGE } },
  },
  {
    name: "adminListDriversPage",
    url: `${base}/adminListDriversPage`,
    body: { data: PAGE },
  },
];

const samples = {
  adminApiScan: [],
  adminListDriversPage: [],
};

for (let i = 0; i < SAMPLES; i += 1) {
  for (const target of targets) {
    const result = await callOnce(target.url, target.body);
    samples[target.name].push(result);
    console.log(JSON.stringify({ name: target.name, i, ms: result.ms, status: result.status }));
  }
}

for (const target of targets) {
  const ok = samples[target.name].filter((sample) => sample.status === "ok").map((sample) => sample.ms).sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      name: target.name,
      n: samples[target.name].length,
      ok: ok.length,
      p50: percentile(ok, 50),
      p95: percentile(ok, 95),
    }),
  );
}
