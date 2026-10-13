/**
 * Read-only check for a dedicated probe account.
 * Prints yes/no only. Never prints an email, uid, or token.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const auth = getAuth(app);
const db = getFirestore(app, "default");

let probeAuth = false;
let pageToken;
do {
  const page = await auth.listUsers(1000, pageToken);
  for (const user of page.users) {
    const email = user.email?.toLowerCase() ?? "";
    if (email.startsWith("perf-probe@")) probeAuth = true;
  }
  pageToken = page.pageToken;
} while (pageToken && !probeAuth);

let probeProfile = false;
const profiles = await db.collection("profiles").where("is_probe", "==", true).limit(1).get();
probeProfile = !profiles.empty;

console.log(`probe_auth=${probeAuth ? "yes" : "no"}`);
console.log(`probe_profile=${probeProfile ? "yes" : "no"}`);
if (!probeAuth && !probeProfile) process.exitCode = 2;
