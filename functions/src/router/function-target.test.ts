import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SECRET_PROBE = "adminPerfPingHeavySecret";
const indexJs = fileURLToPath(new URL("../../lib/index.js", import.meta.url));

function exportNames(target: string | undefined): string[] {
  const env = { ...process.env };
  delete env.FUNCTION_TARGET;
  if (target !== undefined) env.FUNCTION_TARGET = target;
  const script = `
    const mod = require(${JSON.stringify(indexJs)});
    const names = Object.keys(mod).filter((key) => key !== "__esModule").sort();
    process.stdout.write("\\n__EXPORTS__" + JSON.stringify(names));
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const match = result.stdout.match(/__EXPORTS__(.*)/);
  assert.ok(match?.[1], result.stdout);
  return JSON.parse(match[1]) as string[];
}

describe("FUNCTION_TARGET gating", () => {
  it("exports the full catalog when unset and only the target when set", { timeout: 180_000 }, () => {
    const full = exportNames(undefined);
    assert.equal(full.includes("adminApi"), true);
    assert.equal(full.includes("adminApiScan"), true);
    assert.equal(full.includes("adminApiHeavy"), true);
    assert.equal(full.includes("adminPerfPing"), true);
    assert.equal(full.includes("syncStaffClaims"), true);
    assert.equal(full.includes("driverPasscodeLogin"), true);
    assert.equal(full.includes(SECRET_PROBE), false);

    const lane = exportNames("adminApi");
    assert.deepEqual(lane, ["adminApi"]);
    assert.equal(lane.includes("adminPerfPing"), false);
    assert.equal(lane.includes("adminListDriversPage"), false);

    const legacy = exportNames("adminPerfPing");
    assert.deepEqual(legacy, ["adminPerfPing"]);
  });
});
