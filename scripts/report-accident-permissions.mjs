/**
 * Read-only: who holds `vehicles.view` / `vehicles.manage` today?
 *
 * Accident Management deliberately reuses the existing fleet permission pair
 * (client condition 6: no new slug, no grant). This script is how that claim is
 * stated rather than assumed — it opens Firestore read-only and writes nothing:
 * no role, no tick, no epoch bump, no document of any kind.
 *
 *   node scripts/report-accident-permissions.mjs
 *
 * The resolution below mirrors `src/lib/auth/profile-auth.ts`:
 *   - `access_kind` partner → no fleet permission at all;
 *   - `access_kind` manager, or a super-admin role → the whole catalog, so both;
 *   - `access_kind` user → their own ticks when the tick doc exists and is not
 *     empty, otherwise their role's `permission_slugs`.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const SLUGS = ["vehicles.view", "vehicles.manage"];

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const [rolesSnap, rolePermSnap, catalogSnap, profilesSnap] = await Promise.all([
  db.collection("admin_roles").get(),
  db.collection("admin_role_permissions").get(),
  db.collection("admin_permissions").doc("catalog").get(),
  db.collection("profiles").get(),
]);

const catalogSlugs = Array.isArray(catalogSnap.get("slugs"))
  ? catalogSnap.get("slugs").filter((slug) => typeof slug === "string")
  : [];

const roleSlugs = new Map();
for (const doc of rolePermSnap.docs) {
  const slugs = doc.get("permission_slugs");
  roleSlugs.set(doc.id, Array.isArray(slugs) ? slugs.filter((slug) => typeof slug === "string") : []);
}

const roles = rolesSnap.docs.map((doc) => ({
  id: doc.id,
  slug: String(doc.get("slug") ?? ""),
  name: String(doc.get("name") ?? ""),
  isSuperAdmin: doc.get("is_super_admin") === true,
  isSystem: doc.get("is_system") === true,
  slugs: roleSlugs.get(doc.id) ?? [],
}));

console.log("Accident Management — permission report (read-only, nothing written)\n");
console.log(`catalog slugs                   : ${catalogSlugs.length}`);
for (const slug of SLUGS) {
  console.log(
    `${slug.padEnd(31)}: ${catalogSlugs.includes(slug) ? "in catalog" : "MISSING from catalog"}`,
  );
}

console.log("\nRoles");
console.log("  slug                          super  vehicles.view  vehicles.manage");
for (const role of roles.sort((a, b) => a.slug.localeCompare(b.slug))) {
  const view = role.isSuperAdmin || role.slugs.includes("vehicles.view") ? "yes" : "no";
  const manage = role.isSuperAdmin || role.slugs.includes("vehicles.manage") ? "yes" : "no";
  console.log(
    `  ${role.slug.padEnd(29)} ${String(role.isSuperAdmin).padEnd(6)} ${view.padEnd(14)} ${manage}`,
  );
}

const staff = profilesSnap.docs
  .map((doc) => ({
    id: doc.id,
    name: String(doc.get("full_name") ?? ""),
    email: String(doc.get("email") ?? ""),
    roleId: doc.get("admin_role_id") ?? null,
    accessKind: String(doc.get("access_kind") ?? "user"),
    department: String(doc.get("staff_department") ?? ""),
    archived: doc.get("archived_at") != null,
    approval: String(doc.get("approval_status") ?? ""),
  }))
  .filter((row) => row.roleId);

const tickDocs = await Promise.all(
  staff.map((row) => db.collection("admin_user_permissions").doc(row.id).get()),
);
const ticks = new Map();
tickDocs.forEach((snap, index) => {
  const slugs = snap.exists ? snap.get("permission_slugs") : null;
  ticks.set(
    staff[index].id,
    Array.isArray(slugs) ? slugs.filter((slug) => typeof slug === "string") : null,
  );
});

function effective(row) {
  const role = roles.find((entry) => entry.id === row.roleId);
  if (!role) return [];
  if (row.accessKind === "partner") return [];
  if (role.isSuperAdmin || row.accessKind === "manager") return catalogSlugs;
  const own = ticks.get(row.id);
  if (own && own.length > 0) return own;
  return role.slugs;
}

const holders = staff
  .map((row) => {
    const slugs = effective(row);
    return {
      ...row,
      role: roles.find((entry) => entry.id === row.roleId)?.slug ?? "",
      view: slugs.includes("vehicles.view"),
      manage: slugs.includes("vehicles.manage"),
    };
  })
  .filter((row) => row.view || row.manage)
  .sort((a, b) => (a.department || "").localeCompare(b.department || "") || a.email.localeCompare(b.email));

console.log("\nStaff accounts holding either slug");
console.log("  department              access    view  manage  role            email");
for (const row of holders) {
  console.log(
    `  ${(row.department || "—").padEnd(23)} ${row.accessKind.padEnd(9)} ${(row.view ? "yes" : "no").padEnd(5)} ${(row.manage ? "yes" : "no").padEnd(7)} ${row.role.padEnd(15)} ${row.email || row.id}`,
  );
}

const archived = holders.filter((row) => row.archived).length;
console.log(`\nholders                        : ${holders.length} (archived: ${archived})`);
console.log("granted by this change         : none");
