import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plan = await import(pathToFileURL(path.join(root, "functions/src/core/backfill-plan.ts")).href);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function readCheckpoint(file) {
  if (!file) return { lastId: null, written: 0 };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return {
      lastId: typeof parsed.lastId === "string" ? parsed.lastId : null,
      written: typeof parsed.written === "number" ? parsed.written : 0,
    };
  } catch {
    return { lastId: null, written: 0 };
  }
}

const reconcile = process.argv.includes("--reconcile");
const apply = process.argv.includes("--apply") || reconcile;
const confirm = process.env.CONFIRM_BACKFILL_APPLY;
const snapshotId = process.env.BACKFILL_SNAPSHOT_ID;

if (apply && confirm !== "yes") {
  console.error("confirm_required");
  process.exit(2);
}
if (apply && (!snapshotId || snapshotId.trim() === "")) {
  console.error("snapshot_required");
  process.exit(2);
}

const fixtures = process.argv.includes("--fixtures");
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (apply && fixtures && !emulator) {
  console.error("fixtures_require_emulator");
  process.exit(2);
}

if (process.argv.includes("--resume") && !apply) {
  const checkpoint = readCheckpoint(argValue("--checkpoint"));
  console.log(`resume_written=${checkpoint.written}`);
}

if (!apply) {
  if (process.argv.includes("--plan-fixtures")) {
    const fixture = plan.syntheticComparisonFixture();
    const writes = plan.planSearchWrites(fixture.searchDocs);
    const rollups = plan.planRollupDocuments(fixture.deliveries, fixture.attendance);
    const byCollection = {};
    for (const write of writes) {
      byCollection[write.collection] = (byCollection[write.collection] ?? 0) + 1;
    }
    process.stdout.write(
      `${plan.formatDryRunCounts({
        source: fixture.source,
        searchWrites: writes.length,
        driverDaySets: rollups.driverDays.length,
        zoneMonthSets: rollups.zoneMonths.length,
        byCollection,
      })}\n`,
    );
    process.exit(0);
  }

  process.stdout.write(
    `${plan.formatDryRunCounts({
      source: "none",
      searchWrites: 0,
      driverDaySets: 0,
      zoneMonthSets: 0,
      byCollection: {},
    })}\n`,
  );
  process.exit(0);
}

const applyMod = await import(pathToFileURL(path.join(root, "functions/src/core/backfill-apply.ts")).href);
const db = applyMod.openApplyFirestore();
const sourceInput = fixtures
  ? plan.syntheticComparisonFixture()
  : await applyMod.loadProductionApplyInput(db);
const built = plan.buildApplyPlan({
  deliveries: sourceInput.deliveries,
  attendance: sourceInput.attendance,
  searchDocs: sourceInput.searchDocs,
});
const decision = plan.applyGuard({
  apply: true,
  confirm,
  snapshotId,
  scanMismatches: built.mismatches,
});
if (!decision.ok) {
  console.error(decision.reason);
  process.exit(decision.code);
}

const checkpointFile = process.argv.includes("--resume") ? argValue("--checkpoint") : null;
let afterId = null;
let written = 0;
if (checkpointFile) {
  const checkpoint = readCheckpoint(checkpointFile);
  afterId = checkpoint.lastId;
  written = checkpoint.written;
}

while (true) {
  const slice = plan.resumeSlice(built.writes, afterId);
  if (slice.batch.length === 0) break;
  await applyMod.commitApplyBatch(db, slice.batch);
  written += slice.batch.length;
  afterId = slice.batch[slice.batch.length - 1]?.id ?? afterId;
  if (checkpointFile && afterId) {
    writeFileSync(checkpointFile, JSON.stringify({ lastId: afterId, written }));
  }
  if (!slice.checkpoint) break;
}

const lines = [
  reconcile ? "reconcile=true" : "apply=true",
  "set_mode=absolute",
  `source=${fixtures ? "synthetic" : "production"}`,
  "scan_mismatches=0",
  "snapshot=present",
  `target=${emulator ? "emulator" : "production"}`,
  `apply_writes=${written}`,
];
process.stdout.write(`${lines.join("\n")}\n`);
