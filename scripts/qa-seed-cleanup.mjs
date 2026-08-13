/**
 * Removes the tagged RCM / Visit / E-Sign QA seed from production.
 *
 *   node scripts/qa-seed-cleanup.mjs              # dry run — reports, deletes nothing
 *   node scripts/qa-seed-cleanup.mjs --confirm    # performs the deletion
 *
 * Scoped by tag, never by code prefix: RCM-90xx and VIS-990xx sit inside the live
 * sequence ranges, so a future real request could land on one of those codes.
 *
 * It deliberately touches no driver row. `10001` and `10002` predate the seed by two
 * months and one of them carries ~1,100 real deliveries; the seed only borrowed them.
 *
 * Safe to re-run: every step resolves its ids from the tag first, so a second pass
 * reports zeros instead of failing.
 */
import { readFileSync } from "node:fs";

const TAG = "2026-08-12";
const CONFIRM = process.argv.includes("--confirm");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) throw new Error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

const headers = { Authorization: `Bearer ${KEY}`, apikey: KEY, "Content-Type": "application/json" };

const rest = async (path, init = {}) => {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : [];
};

const select = (table, query) => rest(`${table}?${query}`);

const removeRows = async (table, ids, column = "id") => {
  if (!ids.length) return 0;
  if (!CONFIRM) return ids.length;
  const deleted = await rest(`${table}?${column}=in.(${ids.join(",")})`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  return deleted.length;
};

// ---------------------------------------------------------------- resolve the seed

const requests = await select(
  "requests",
  `select=id,request_code&payload->>qa_seed=eq.${TAG}&order=request_code`,
);
const bookings = await select(
  "visit_bookings",
  `select=id,booking_code&note=like.*%5Bqa_seed%20${TAG}%5D*&order=booking_code`,
);
const esign = await select(
  "esign_requests",
  `select=id,request_code,document_storage_key,signed_document_storage_key&signer_meta->>qa_seed=eq.${TAG}&order=request_code`,
);

const requestIds = requests.map((r) => r.id);
const bookingIds = bookings.map((b) => b.id);
const esignIds = esign.map((e) => e.id);

if (!requestIds.length && !bookingIds.length && !esignIds.length) {
  console.log(`No rows carry the qa_seed tag ${TAG}. Nothing to do.`);
  process.exit(0);
}

const childIds = async (table, column, parents) =>
  parents.length ? (await select(table, `select=id&${column}=in.(${parents.join(",")})`)).map((r) => r.id) : [];

const steps = await childIds("request_approval_steps", "request_id", requestIds);
const clarifications = await childIds("request_clarifications", "request_id", requestIds);
const attachments = await childIds("request_attachments", "request_id", requestIds);
const loanTerms = await childIds("loan_terms", "request_id", requestIds);
const bookingNotes = await childIds("visit_booking_notes", "booking_id", bookingIds);

/**
 * Transactional notifications are not FK-linked to the row they announce — they only carry a
 * deep link. A previous QA cleanup deleted 3 appointments and left 4 campaigns pointing at
 * dead ids, which is why these are resolved and removed here rather than left behind.
 */
const seedIds = [...requestIds, ...bookingIds, ...esignIds];
const campaigns = (
  await select(
    "notification_campaigns",
    `select=id,title,action_params&target_spec->>mode=eq.transactional`,
  )
).filter((c) => {
  const link = c.action_params?.deep_link ?? "";
  return seedIds.some((id) => link.includes(id));
});

/** Only objects the seed itself uploaded: the demo-qa/ sources and the composed signed copy. */
const objects = [
  ...new Set(
    esign
      .flatMap((e) => [e.document_storage_key, e.signed_document_storage_key])
      .filter((k) => k && (k.startsWith("demo-qa/") || k.startsWith("signed/")))
      .concat("demo-qa/signature.png"),
  ),
];

// ---------------------------------------------------------------------- report + act

console.log(`${CONFIRM ? "DELETING" : "DRY RUN — would delete"} qa_seed ${TAG} from ${URL_BASE}\n`);
console.log(`  requests               ${requestIds.length}  ${requests.map((r) => r.request_code).join(", ")}`);
console.log(`    request_approval_steps ${steps.length}`);
console.log(`    request_clarifications ${clarifications.length}`);
console.log(`    request_attachments    ${attachments.length}`);
console.log(`    loan_terms             ${loanTerms.length}`);
console.log(`  visit_bookings         ${bookingIds.length}  ${bookings.map((b) => b.booking_code).join(", ")}`);
console.log(`    visit_booking_notes    ${bookingNotes.length}`);
console.log(`  esign_requests         ${esignIds.length}  ${esign.map((e) => e.request_code).join(", ")}`);
console.log(`  notification_campaigns ${campaigns.length}  ${campaigns.map((c) => c.title).join(", ")}`);
console.log(`  storage objects        ${objects.length}  ${objects.join(", ")}`);
console.log("\n  drivers, profiles and deliveries: untouched by design\n");

if (!CONFIRM) {
  console.log("Re-run with --confirm to perform the deletion.");
  process.exit(0);
}

// Children first. Every child FK is ON DELETE CASCADE, so this is belt and braces — but it
// keeps the log honest about what left the database.
const counts = {
  request_approval_steps: await removeRows("request_approval_steps", steps),
  request_clarifications: await removeRows("request_clarifications", clarifications),
  request_attachments: await removeRows("request_attachments", attachments),
  loan_terms: await removeRows("loan_terms", loanTerms),
  visit_booking_notes: await removeRows("visit_booking_notes", bookingNotes),
  requests: await removeRows("requests", requestIds),
  // Both seed bookings go in one statement: visit_bookings.rescheduled_from_id is NO ACTION,
  // so deleting a reschedule source before its successor would fail on the row-level check.
  visit_bookings: await removeRows("visit_bookings", bookingIds),
  esign_requests: await removeRows("esign_requests", esignIds),
  notification_campaigns: await removeRows("notification_campaigns", campaigns.map((c) => c.id)),
};

for (const [table, n] of Object.entries(counts)) console.log(`  deleted ${n} from ${table}`);

if (objects.length) {
  const res = await fetch(`${URL_BASE}/storage/v1/object/esign-documents`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ prefixes: objects }),
  });
  console.log(`  ${res.status} storage esign-documents (${objects.length} prefixes)`);
}

console.log("\nDone. Re-run without --confirm to confirm the tag is gone.");
