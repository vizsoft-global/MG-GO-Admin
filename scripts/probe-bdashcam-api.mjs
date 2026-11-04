#!/usr/bin/env node
/**
 * BDashcam (VSS GPS MEA) open-API connectivity probe — read only.
 *
 * What this proves
 * ----------------
 * The documented server for the open API is `https://vssgpsmea.live`, and every
 * documented endpoint expects `POST /sys/login` with `{ appCid, appSecret }`
 * first, then a token on the following calls. From outside the vendor network
 * neither of those works, and the two failures are different:
 *
 *   1. `https://vssgpsmea.live/sys/login` answers **405** from nginx — that host
 *      serves the web panel and only accepts GET.
 *   2. `https://api.vssgpsmea.live/vehicle-admin/sys/login` answers 200 with
 *      `{"code":401,"message":"Not logged in yet or token has expired!"}` —
 *      and returns that identical body for **every path**, including paths that
 *      do not exist. A missing path cannot be "not logged in", so a token check
 *      is rejecting the login call itself before it is read.
 *
 * This script performs exactly those calls and prints the raw reply for each, so
 * the vendor can see it rather than take our word for it. It sends nothing that
 * writes, changes or deletes anything, and it prints no credential values — only
 * whether a value was supplied.
 *
 * Usage
 * -----
 *   BDASHCAM_APP_CID=... BDASHCAM_APP_SECRET=... node scripts/probe-bdashcam-api.mjs
 *   node scripts/probe-bdashcam-api.mjs --cid <appCid> --secret <appSecret>
 *   node scripts/probe-bdashcam-api.mjs --cid ... --secret ... --plate 12345
 *
 * Requires Node 18 or newer (for the built-in `fetch`). No dependencies.
 */

const cidArg = argValue("--cid") ?? process.env.BDASHCAM_APP_CID ?? "";
const secretArg = argValue("--secret") ?? process.env.BDASHCAM_APP_SECRET ?? "";
const plateArg = argValue("--plate") ?? process.env.BDASHCAM_PLATE ?? "";

const TIMEOUT_MS = 15_000;

/**
 * The host the documentation names, and the host the vendor's own web panel
 * uses to reach its API (found in the panel bundle's `API_ROOT`).
 */
const BASES = [
  { label: "documented server", base: "https://vssgpsmea.live" },
  { label: "guessed API gateway", base: "https://api.vssgpsmea.live/vehicle-admin" },
  { label: "guessed API gateway (bare)", base: "https://api.vssgpsmea.live" },
];

/** Every credential presentation named in the OpenAPI security scheme, plus the plain ones. */
const AUTH = [
  {
    label: "appCid / appSecret as JSON body (documented)",
    headers: {},
    body: true,
  },
  {
    label: "appCid / appSecret as headers",
    headers: { appCid: cidArg, appSecret: secretArg },
  },
  {
    label: "AppCid / AppSecret as headers (as capitalised in the docs)",
    headers: { AppCid: cidArg, AppSecret: secretArg },
  },
  {
    label: "Authorization: <appCid>",
    headers: { Authorization: cidArg },
  },
  {
    label: "Authorization: <appCid>:<appSecret>",
    headers: { Authorization: `${cidArg}:${secretArg}` },
  },
  {
    label: "Authorization: Basic base64(appCid:appSecret)",
    headers: { Authorization: `Basic ${base64(`${cidArg}:${secretArg}`)}` },
  },
];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? "") : undefined;
}

function base64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

/** One request. Returns the status, the content type and the first 220 bytes. */
async function call(url, init) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await response.text();
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "—",
      body: body.replace(/\s+/g, " ").trim().slice(0, 220),
      ms: Date.now() - startedAt,
    };
  } catch (error) {
    return { error: String(error).slice(0, 160), ms: Date.now() - startedAt };
  }
}

function report(title, result) {
  console.log(`  ${title}`);
  if (result.error) {
    console.log(`    transport error: ${result.error} (${result.ms}ms)`);
    return;
  }
  console.log(`    HTTP ${result.status}  ${result.contentType}  ${result.ms}ms`);
  console.log(`    ${result.body || "(empty body)"}`);
}

async function main() {
  console.log("BDashcam open-API connectivity probe");
  console.log("====================================");
  console.log(`AppCid supplied    : ${cidArg ? "yes" : "no"}`);
  console.log(`AppSecret supplied : ${secretArg ? "yes" : "no"}`);
  console.log("");

  if (!cidArg || !secretArg) {
    console.error("Missing credentials. Set BDASHCAM_APP_CID and BDASHCAM_APP_SECRET,");
    console.error("or pass --cid <appCid> --secret <appSecret>.");
    process.exit(2);
  }

  for (const { label, base } of BASES) {
    console.log(`\n# ${label}: ${base}`);

    for (const attempt of AUTH) {
      const result = await call(`${base}/sys/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...attempt.headers },
        body: JSON.stringify({ appCid: cidArg, appSecret: secretArg }),
      });
      report(`POST /sys/login — ${attempt.label}`, result);
    }

    // A path that cannot exist. Its reply is the control: if this and the login
    // call answer the same thing, no per-path routing happened at all.
    report(
      "POST /sys/login-ish-path-that-cannot-exist (control)",
      await call(`${base}/this-path-does-not-exist-probe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appCid: cidArg, appSecret: secretArg }),
      }),
    );
  }

  if (plateArg) {
    console.log(`\n# Odometer read (documented as one plate per call): /position/realtime/vehicleGps?licenseNum=${plateArg}`);
    for (const { label, base } of BASES) {
      report(
        `${label} — GET /position/realtime/vehicleGps`,
        await call(`${base}/position/realtime/vehicleGps?licenseNum=${encodeURIComponent(plateArg)}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            AppCid: cidArg,
            AppSecret: secretArg,
          },
        }),
      );
    }
  }

  console.log("\nWhat this tells us");
  console.log("==================");
  console.log("• A 405 on /sys/login means that host is the web panel, not the API.");
  console.log("• An identical 401 body on the login call AND on a path that does not");
  console.log("  exist means a gateway token check rejects the request before routing.");
  console.log("• Neither can be worked around from our side: we need the API host, the");
  console.log("  egress IP policy, and one successful /sys/login response shape.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
