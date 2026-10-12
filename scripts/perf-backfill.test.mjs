import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./perf-backfill.mjs", import.meta.url));
const functionsDir = fileURLToPath(new URL("../functions", import.meta.url));

function run(args, env = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: functionsDir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("perf-backfill", () => {
  it("dry-run prints counts only", () => {
    const result = run([]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /dry_run=true/);
    assert.match(result.stdout, /source=none/);
    assert.match(result.stdout, /writes=0/);
    assert.equal(result.stdout.includes("{"), false);
    assert.equal(result.stdout.includes("Jenson"), false);
  });

  it("refuses apply without the confirm env", () => {
    const result = run(["--apply"], { CONFIRM_BACKFILL_APPLY: "" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /confirm_required/);
  });

  it("exits non-zero when a comparison report has mismatches", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "perf-backfill-"));
    const file = path.join(dir, "report.json");
    writeFileSync(file, JSON.stringify({ source: "synthetic", mismatches: 3, driverDays: 1, zoneMonths: 1 }));
    const result = run(["--comparison", file, "--apply"], { CONFIRM_BACKFILL_APPLY: "yes" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /comparison_mismatch/);
  });
});
