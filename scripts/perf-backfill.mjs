import { readFileSync } from "node:fs";
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

function loadReport(file) {
  if (!file) return null;
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return {
    source: parsed.source === "production" ? "production" : "synthetic",
    mismatches: typeof parsed.mismatches === "number" ? parsed.mismatches : 0,
    driverDays: typeof parsed.driverDays === "number" ? parsed.driverDays : 0,
    zoneMonths: typeof parsed.zoneMonths === "number" ? parsed.zoneMonths : 0,
  };
}

const apply = process.argv.includes("--apply");
const report = loadReport(argValue("--comparison"));
if (report && report.mismatches !== 0) {
  console.error("comparison_mismatch");
  process.exit(1);
}

const decision = plan.applyGuard({
  apply,
  confirm: process.env.CONFIRM_BACKFILL_APPLY,
  report,
});
if (!decision.ok) {
  console.error(decision.reason);
  process.exit(decision.code);
}

if (process.argv.includes("--resume")) {
  const file = argValue("--checkpoint");
  let written = 0;
  if (file) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (typeof parsed.written === "number") written = parsed.written;
    } catch {
      written = 0;
    }
  }
  console.log(`resume_written=${written}`);
}

if (apply) {
  console.log("production_writes=0");
  console.log("apply_skipped_no_production_client");
  process.exit(0);
}

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
