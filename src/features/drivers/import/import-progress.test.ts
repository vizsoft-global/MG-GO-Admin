import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IMPORT_CHUNK_APPROVE,
  IMPORT_CHUNK_SAVE,
  chunkRows,
  formatImportLogLine,
  importChunkSize,
} from "./import-progress";

describe("importChunkSize", () => {
  it("keeps a save-only batch larger so a hundred rows do not become twenty trips", () => {
    assert.equal(
      importChunkSize([{ active: null }, { active: false }], false),
      IMPORT_CHUNK_SAVE,
    );
  });

  it("shrinks when any row will mint a login — that is the hang", () => {
    assert.equal(importChunkSize([{ active: true }], false), IMPORT_CHUNK_APPROVE);
    assert.equal(importChunkSize([{ active: null }], true), IMPORT_CHUNK_APPROVE);
  });
});

describe("chunkRows", () => {
  it("splits a hundred rows into trips the server can finish", () => {
    const rows = Array.from({ length: 12 }, (_, i) => i);
    assert.deepEqual(chunkRows(rows, 5), [
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
      [10, 11],
    ]);
  });
});

describe("formatImportLogLine", () => {
  it("writes a created line the way a journalctl row reads", () => {
    const line = formatImportLogLine({
      at: "2026-08-31T09:57:03.000Z",
      kind: "created",
      rowIndex: 2,
      name: "Ahmed Ali",
      employeeId: "12345",
      zone: "Hawalli",
      driverCode: "10023",
    });
    assert.match(line, /\]  \+  created   Ahmed Ali/);
    assert.match(line, /emp=12345/);
    assert.match(line, /zone=Hawalli/);
    assert.match(line, /code=10023/);
    assert.doesNotMatch(line, /passcode/i);
  });

  it("marks a failure and never invents a name", () => {
    const line = formatImportLogLine({
      at: "2026-08-31T09:57:04.000Z",
      kind: "failed",
      rowIndex: 11,
      name: "",
      detail: "missing_assignment",
    });
    assert.match(line, /!  failed    row 12/);
    assert.match(line, /missing_assignment/);
  });
});
