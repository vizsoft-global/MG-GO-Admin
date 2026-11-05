/**
 * Fleet Service permissions — READ ONLY report.
 *
 * Prints every role and every staff account that currently holds
 * `vehicles.view` / `vehicles.manage`, so a super admin can decide who should
 * get `service.view` / `service.manage` / `service.export`.
 *
 *   node scripts/report-service-permissions.mjs
 *
 * Writes nothing. The three service slugs are in the permission catalog but no
 * role and no user holds them until somebody ticks them in Roles & Permissions.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const WATCHED = ["vehicles.view", "vehicles.manage"];
const SERVICE_SLUGS = ["service.view", "service.manage", "service.export"];

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

function slugsOf(doc) {
  const value = doc?.get("permission_slugs");
  return Array.isArray(value) ? value : [];
}

const roles = await db.collection("admin_roles").get();
const roleRows = [];
for (const doc of roles.docs) {
  const permSnap = await db.collection("admin_role_permissions").doc(doc.id).get();
  const slugs = slugsOf(permSnap);
  roleRows.push({
    id: doc.id,
    name: doc.get("name") ?? doc.get("label") ?? doc.id,
    accessKind: doc.get("access_kind") ?? null,
    department: doc.get("department") ?? null,
    watched: WATCHED.filter((slug) => slugs.includes(slug)),
    service: SERVICE_SLUGS.filter((slug) => slugs.includes(slug)),
  });
}

console.log("=== Roles ===");
for (const role of roleRows) {
  const tag = role.watched.length > 0 ? role.watched.join(", ") : "—";
  const service = role.service.length > 0 ? role.service.join(", ") : "none";
  console.log(
    `${role.id.padEnd(24)} ${String(role.name).padEnd(28)} dept=${String(role.department ?? "—").padEnd(16)} kind=${String(role.accessKind ?? "—").padEnd(11)} holds=${tag} | service=${service}`,
  );
}

const profiles = await db.collection("profiles").get();
const staff = profiles.docs.filter((doc) => doc.get("role") === "staff");
const users = [];
for (const doc of staff) {
  const ticksSnap = await db.collection("admin_user_permissions").doc(doc.id).get();
  const ticks = slugsOf(ticksSnap);
  const roleId = doc.get("admin_role_id");
  const role = roleRows.find((row) => row.id === roleId);
  const watched = new Set([...ticks.filter((slug) => WATCHED.includes(slug)), ...(role?.watched ?? [])]);
  if (watched.size === 0) continue;
  users.push({
    id: doc.id,
    email: doc.get("email") ?? null,
    name: doc.get("full_name") ?? null,
    department: doc.get("staff_department") ?? null,
    accessKind: doc.get("access_kind") ?? null,
    role: role?.name ?? roleId ?? "—",
    archived: doc.get("archived_at") != null,
    watched: [...watched],
    ticksService: ticks.filter((slug) => SERVICE_SLUGS.includes(slug)),
  });
}

console.log("\n=== Staff holding vehicles.view / vehicles.manage ===");
if (users.length === 0) console.log("(none — every staff tick is empty)");
for (const user of users) {
  console.log(
    `${String(user.email ?? user.id).padEnd(38)} ${String(user.name ?? "—").padEnd(26)} dept=${String(user.department ?? "—").padEnd(16)} kind=${String(user.accessKind ?? "—").padEnd(11)} role=${user.role} holds=${user.watched.join(", ")}${user.archived ? " [ARCHIVED]" : ""}`,
  );
}

console.log("\n=== Service slugs currently granted ===");
const grantedRoles = roleRows.filter((role) => role.service.length > 0);
const grantedUsers = users.filter((user) => user.ticksService.length > 0);
console.log(`roles: ${grantedRoles.length}, users: ${grantedUsers.length}`);
for (const role of grantedRoles) console.log(`  role ${role.id}: ${role.service.join(", ")}`);
for (const user of grantedUsers) console.log(`  user ${user.email ?? user.id}: ${user.ticksService.join(", ")}`);

console.log("\nNothing was written. Grant ticks in Roles & Permissions when the list above is agreed.");
