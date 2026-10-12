/**
 * Reads compiled callable endpoints. Run after `npm run build` in functions/.
 * FUNCTION_TARGET stays unset so the full catalog is what deploy analysis sees.
 * Does not deploy and does not call a function.
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

delete process.env.FUNCTION_TARGET;

const require = createRequire(import.meta.url);
const built = require("../functions/lib/index.js");
const lanes = require("../functions/lib/router/lanes.js");

const FIELDS = [
  "secretEnvironmentVariables",
  "timeoutSeconds",
  "availableMemoryMb",
  "cpu",
  "serviceAccountEmail",
  "callableTrigger",
  "enforceAppCheck",
  "cors",
  "minInstances",
  "invoker",
  "vpc",
  "ingressSettings",
];

function pick(fn) {
  const flat = JSON.parse(JSON.stringify(fn?.__endpoint ?? {}));
  const out = {};
  for (const field of FIELDS) out[field] = flat[field] ?? null;
  return out;
}

const laneIds = ["light", "scan", "heavy"];
const functions = {};
for (const lane of laneIds) {
  for (const name of lanes.functionsForLane(lane)) {
    if (!built[name]) throw new Error(`allowlisted export missing from the build: ${name}`);
    functions[name] = { lane, ...pick(built[name]) };
  }
}

const laneEndpoints = {};
for (const name of lanes.LANE_EXPORT_NAMES) {
  laneEndpoints[name] = pick(built[name]);
}

const esignName = "esignComposeSignedDocument";
const esign = functions[esignName];
const heavy = laneEndpoints.adminApiHeavy;
const identityFields = ["serviceAccountEmail", "enforceAppCheck", "cors"];
const blockers = [];
if (!esign || esign.lane !== "heavy") blockers.push("not a heavy member");
for (const field of identityFields) {
  if (JSON.stringify(esign?.[field] ?? null) !== JSON.stringify(heavy?.[field] ?? null)) {
    blockers.push(field);
  }
}
const esignSecrets = new Set((esign?.secretEnvironmentVariables ?? []).map((item) => item?.key ?? item));
const heavySecrets = new Set((heavy?.secretEnvironmentVariables ?? []).map((item) => item?.key ?? item));
for (const secret of esignSecrets) {
  if (!heavySecrets.has(secret)) blockers.push(`secret:${secret}`);
}

const inventory = {
  project: "musallam-delivery-prod",
  region: "me-central1",
  sharedModule: "functions/src/router/lanes.ts",
  functions,
  lanes: laneEndpoints,
  excluded: {
    workerHttp: lanes.WORKER_HTTP_FUNCTIONS,
    reason: "onRequest plus WORKER_SHARED_SECRET; not an onCall lane",
  },
  esignComposeSignedDocument: {
    joinedHeavy: blockers.length === 0,
    blockers,
  },
};

const outPath = fileURLToPath(new URL("../functions/router-inventory.json", import.meta.url));
writeFileSync(outPath, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(
  `wrote ${Object.keys(functions).length} functions; esignComposeSignedDocument joinedHeavy=${blockers.length === 0}`,
);
if (blockers.length > 0) {
  console.error(`esignComposeSignedDocument blockers: ${blockers.join(", ")}`);
  process.exit(1);
}
