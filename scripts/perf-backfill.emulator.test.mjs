import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function allowEnv(extra) {
  const keep = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "windir",
    "SystemDrive",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "COMSPEC",
    "PROGRAMFILES",
  ];
  const env = {};
  for (const key of keep) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, ...extra };
}

describe("backfill emulator", () => {
  it("applies the fixture only inside the firestore emulator", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "perf-backfill-emu-"));
    const config = path.join(dir, "firebase.json");
    writeFileSync(
      config,
      JSON.stringify({
        emulators: {
          firestore: { host: "127.0.0.1", port: 8098 },
          ui: { enabled: false },
        },
      }),
    );
    const result = spawnSync(
      `firebase emulators:exec --only firestore --project demo-backfill --config "${config}" "node --import tsx scripts/perf-backfill.emulator-inner.mjs"`,
      {
        cwd: root,
        encoding: "utf8",
        timeout: 300000,
        shell: true,
        env: allowEnv({
          GCLOUD_PROJECT: "demo-backfill",
        }),
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /emulator_apply_ok/);
    assert.equal(result.stdout.includes("emu-snapshot"), false);
  });
});
