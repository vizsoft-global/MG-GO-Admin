/**
 * Backfills `expire_at` for event collections written before the TTL field
 * existed. TTL only deletes a document when the field is present, so the 28M
 * row backlog otherwise never drains.
 *
 * Dry run (default):
 *   node scripts/firestore-expiry-backfill.mjs --collection driver_location_events --max-docs 5000
 *
 * Apply one bounded slice:
 *   CONFIRM_EXPIRY_BACKFILL=yes node scripts/firestore-expiry-backfill.mjs \
 *     --collection driver_location_events --max-docs 5000 --apply
 *
 * Repeat with the printed `cursor` until it is null. The script never deletes;
 * it only stamps `expire_at`, and TTL/the existing retention callables drain it.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const STREAMS = {
  driver_location_events: { at: ["recorded_at", "created_at"], days: 90 },
  driver_operation_events: { at: ["occurred_at", "created_at"], days: 30 },
  driver_telemetry_events: { at: ["occurred_at", "created_at"], days: 7 },
};

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const collection = arg("collection");
const stream = STREAMS[collection];
if (!stream) {
  console.error(`--collection must be one of: ${Object.keys(STREAMS).join(", ")}`);
  process.exit(1);
}
const batchSize = Math.max(1, Math.min(500, Number(arg("batch", "500"))));
const maxDocs = Math.max(1, Number(arg("max-docs", "5000")));
const startedAfter = arg("cursor");
const apply = process.argv.includes("--apply");

if (apply && process.env.CONFIRM_EXPIRY_BACKFILL !== "yes") {
  console.error("Refusing to write without CONFIRM_EXPIRY_BACKFILL=yes");
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

async function readAt(doc) {
  const data = doc.data() ?? {};
  for (const field of stream.at) {
    const ms = instant(data[field]);
    if (ms != null) return ms;
  }
  return Date.now();
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

while (scanned < maxDocs) {
  const snap = await query.limit(Math.min(batchSize, maxDocs - scanned)).get();
  if (snap.empty) break;

  let batch = db.batch();
  let pending = 0;
  for (const doc of snap.docs) {
    scanned += 1;
    lastId = doc.id;
    const data = doc.data() ?? {};
    if (data.expire_at != null) {
      skipped += 1;
      continue;
    }
    const at = await readAt(doc);
    batch.update(doc.ref, {
      expire_at: Timestamp.fromMillis(at + stream.days * 86_400_000),
    });
    pending += 1;
    stamped += 1;
    if (pending >= 500) {
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
      next_cursor: scanned >= maxDocs ? lastId : null,
    },
    null,
    2,
  ),
);
