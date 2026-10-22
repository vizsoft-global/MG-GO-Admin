/**
 * Read-only probe: print every source_companies row and its incentive config.
 *
 *   node scripts/probe-source-companies.mjs
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const snap = await db.collection("source_companies").get();
console.log(`source_companies rows: ${snap.size}`);
for (const doc of snap.docs) {
  const d = doc.data() ?? {};
  console.log(
    JSON.stringify({
      id: doc.id,
      name: d.name ?? null,
      client_code: d.client_code ?? null,
      is_system: d.is_system === true,
      is_active: d.is_active !== false,
      dpd_target: d.dpd_target ?? null,
      incentive_enabled: d.incentive_enabled === true,
      above: d.incentive_above_kwd ?? null,
      below: d.incentive_below_kwd ?? null,
      effective_from: d.effective_from ?? null,
      sort_order: d.sort_order ?? null,
    }),
  );
}
