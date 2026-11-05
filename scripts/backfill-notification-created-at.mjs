/**
 * Notification campaigns written before `saveNotificationCampaign` stamped
 * `created_at` are invisible to every list read, because the list orders on
 * `created_at` and the date filter bounds it. This backfills the missing field.
 *
 * Fallback order per document: `created_at` → `createdAt` → `updated_at`.
 * A document with none of them is skipped and reported, never guessed at.
 *
 * Dry run (default):
 *   node scripts/backfill-notification-created-at.mjs
 *
 * Apply one bounded slice:
 *   CONFIRM_NOTIFICATION_BACKFILL=yes node scripts/backfill-notification-created-at.mjs --apply
 *
 * Repeat with the printed `next_cursor` until it is null. The script never
 * deletes and never rewrites a document that already has a usable `created_at`.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const collection = arg("collection", "notification_campaigns");
const batchSize = Math.max(1, Math.min(500, Number(arg("batch", "500"))));
const maxDocs = Math.max(1, Number(arg("max-docs", "5000")));
const startedAfter = arg("cursor");
const apply = process.argv.includes("--apply");

if (apply && process.env.CONFIRM_NOTIFICATION_BACKFILL !== "yes") {
  console.error("Refusing to write without CONFIRM_NOTIFICATION_BACKFILL=yes");
  process.exit(1);
}

function instant(value) {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function hasCreatedAt(data) {
  return instant(data.created_at) != null;
}

function fallbackMillis(data) {
  return (
    instant(data.created_at) ??
    instant(data.createdAt) ??
    instant(data.updated_at) ??
    instant(data.updatedAt)
  );
}

const collectionRef = db.collection(collection);
let query = collectionRef.orderBy("__name__").limit(batchSize);
if (startedAfter) {
  const cursorSnap = await collectionRef.doc(startedAfter).get();
  if (!cursorSnap.exists) throw new Error(`cursor not found: ${startedAfter}`);
  query = query.startAfter(cursorSnap);
}

let scanned = 0;
let stamped = 0;
let skipped = 0;
let lastId = startedAfter ?? null;
const skippedIds = [];

while (scanned < maxDocs) {
  const snap = await query.limit(Math.min(batchSize, maxDocs - scanned)).get();
  if (snap.empty) break;

  let batch = db.batch();
  let pending = 0;
  for (const doc of snap.docs) {
    scanned += 1;
    lastId = doc.id;
    const data = doc.data() ?? {};
    if (hasCreatedAt(data)) {
      skipped += 1;
      continue;
    }
    const at = fallbackMillis(data);
    if (at == null) {
      skipped += 1;
      skippedIds.push(doc.id);
      continue;
    }
    batch.update(doc.ref, { created_at: new Date(at).toISOString() });
    pending += 1;
    stamped += 1;
    if (pending >= 400) {
      if (apply) await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0 && apply) await batch.commit();
  if (snap.size < batchSize) break;
  query = collectionRef.orderBy("__name__").startAfter(snap.docs[snap.docs.length - 1]).limit(batchSize);
}

console.log(
  JSON.stringify(
    {
      collection,
      mode: apply ? "apply" : "dry-run",
      scanned,
      stamped,
      skipped,
      skipped_ids: skippedIds.slice(0, 50),
      next_cursor: scanned >= maxDocs ? lastId : null,
    },
    null,
    2,
  ),
);
