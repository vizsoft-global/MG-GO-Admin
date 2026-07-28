#!/usr/bin/env node
/**
 * Create Firebase Admin service account + key for musallam-delivery-prod
 * using the Firebase CLI user's refresh token (from ~/.config/configstore/firebase-tools.json).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const PROJECT_ID = "musallam-delivery-prod";
const SA_ID = "dpd-admin-firebase";
const SA_EMAIL = `${SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com`;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "config", "firebase-prod");
const OUT_FILE = join(OUT_DIR, "service-account.json");

const FIREBASE_TOOLS = join(homedir(), ".config", "configstore", "firebase-tools.json");
async function getAccessToken() {
  const cfg = JSON.parse(readFileSync(FIREBASE_TOOLS, "utf8"));
  const refresh = cfg?.tokens?.refresh_token;
  if (!refresh) throw new Error("No firebase-tools refresh_token; run: firebase login");

  const body = new URLSearchParams({
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    refresh_token: refresh,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function gcp(token, url, method = "GET", json) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: json ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error?.message || text;
    throw new Error(`${method} ${url} → ${res.status}: ${msg}`);
  }
  return data;
}

async function main() {
  const token = await getAccessToken();

  try {
    await gcp(
      token,
      `https://iam.googleapis.com/v1/projects/${PROJECT_ID}/serviceAccounts/${SA_EMAIL}`,
    );
    console.log("Service account already exists:", SA_EMAIL);
  } catch (e) {
    if (!String(e.message).includes("404")) throw e;
    await gcp(
      token,
      `https://iam.googleapis.com/v1/projects/${PROJECT_ID}/serviceAccounts`,
      "POST",
      {
        accountId: SA_ID,
        serviceAccount: { displayName: "DPD Admin Firebase (Production)" },
      },
    );
    console.log("Created service account:", SA_EMAIL);
  }

  const pol = await gcp(
    token,
    `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:getIamPolicy`,
    "POST",
    {},
  );
  const bindings = [...(pol.bindings || [])];
  for (const role of ["roles/firebase.admin", "roles/iam.serviceAccountTokenCreator"]) {
    const member = `serviceAccount:${SA_EMAIL}`;
    const existing = bindings.find((b) => b.role === role);
    if (existing) {
      if (!existing.members.includes(member)) existing.members.push(member);
    } else {
      bindings.push({ role, members: [member] });
    }
  }
  await gcp(
    token,
    `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:setIamPolicy`,
    "POST",
    { policy: { ...pol, bindings } },
  );
  console.log("Granted IAM roles on project");

  const key = await gcp(
    token,
    `https://iam.googleapis.com/v1/projects/${PROJECT_ID}/serviceAccounts/${SA_EMAIL}/keys`,
    "POST",
    { privateKeyType: "TYPE_GOOGLE_CREDENTIALS_FILE", keyAlgorithm: "KEY_ALG_RSA_2048" },
  );

  const b64 = key.privateKeyData;
  const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(json, null, 2));
  console.log("Wrote", OUT_FILE);

  return {
    clientEmail: json.client_email,
    projectId: json.project_id,
    privateKey: json.private_key,
    json: JSON.stringify(json),
  };
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
