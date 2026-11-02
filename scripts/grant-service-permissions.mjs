/**
 * Fleet Service permissions — grant ticks. NOT RUN in this pass.
 *
 * Refuses to touch Firestore unless CONFIRM_GRANT_SERVICE=yes is passed, because
 * the module ships with **no** role and **no** user holding `service.*` — only a
 * super admin's tick should hand them out.
 *
 *   node --import tsx scripts/grant-service-permissions.mjs --user <uid> --slugs service.view,service.export
 *   node --import tsx scripts/grant-service-permissions.mjs --role <roleId> --slugs service.manage
 *
 * It merges into `admin_user_permissions/{uid}` / `admin_role_permissions/{roleId}`
 * `permission_slugs` and never removes a slug that is already there.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";
import { CATALOG_SLUG_SET } from "../src/lib/auth/permission-catalog.ts";

if (process.env.CONFIRM_GRANT_SERVICE !== "yes") {
  console.error("Refusing to run without CONFIRM_GRANT_SERVICE=yes");
  process.exit(1);
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? "" : "";
}

const userId = arg("user");
const roleId = arg("role");
const slugs = arg("slugs")
  .split(",")
  .map((slug) => slug.trim())
  .filter(Boolean);

if ((!userId && !roleId) || slugs.length === 0) {
  console.error("Usage: --user <uid> | --role <roleId>  --slugs service.view,service.manage");
  process.exit(1);
}

for (const slug of slugs) {
  if (!slug.startsWith("service.")) {
    console.error(`Refusing to grant a non-service slug: ${slug}`);
    process.exit(1);
  }
  if (!CATALOG_SLUG_SET.has(slug)) {
    console.error(`Unknown catalog slug: ${slug}`);
    process.exit(1);
  }
}

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const collection = userId ? "admin_user_permissions" : "admin_role_permissions";
const id = userId || roleId;
const ref = db.collection(collection).doc(id);
const snap = await ref.get();
const before = Array.isArray(snap.get("permission_slugs")) ? snap.get("permission_slugs") : [];
const after = [...new Set([...before, ...slugs])];

await ref.set({ permission_slugs: after, updated_at: new Date() }, { merge: true });

console.log(`${collection}/${id}`);
console.log(`  before: ${before.length} slugs (${slugs.filter((slug) => before.includes(slug)).length} of the requested already present)`);
console.log(`  after : ${after.length} slugs`);
console.log("  granted:", slugs.join(", "));
