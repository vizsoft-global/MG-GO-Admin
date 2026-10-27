import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FIRESTORE_DOC_BYTES,
  IMPORT_PAYLOAD_SLICE_BYTES,
  jsonByteLength,
  pendingRowDocId,
  sliceImportRows,
} from "./import-job-rows";

describe("pendingRowDocId", () => {
  it("sorts in sheet order", () => {
    const ids = [0, 1, 2, 10, 100, 1000].map(pendingRowDocId);
    assert.deepEqual([...ids].sort(), ids);
    assert.equal(pendingRowDocId(0), "00000000");
    assert.equal(pendingRowDocId(12), "00000012");
  });
});

describe("sliceImportRows", () => {
  it("returns nothing for an empty sheet", () => {
    assert.deepEqual(sliceImportRows([], IMPORT_PAYLOAD_SLICE_BYTES), []);
  });

  it("keeps every row, in order, and each slice under the cap", () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      index,
      blob: "x".repeat(20_000),
    }));
    const slices = sliceImportRows(rows, 100_000);
    assert.ok(slices.length > 1);
    assert.deepEqual(
      slices.flat().map((row) => row.index),
      rows.map((row) => row.index),
    );
    for (const slice of slices) {
      assert.ok(slice.length > 0);
      assert.ok(jsonByteLength(slice) <= 100_000);
    }
  });

  it("splits a roster that cannot fit in one Firestore document", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      index,
      blob: "x".repeat(80_000),
    }));
    assert.ok(jsonByteLength(rows) > FIRESTORE_DOC_BYTES);
    for (const row of rows) assert.ok(jsonByteLength(row) < FIRESTORE_DOC_BYTES);
    const slices = sliceImportRows(rows, IMPORT_PAYLOAD_SLICE_BYTES);
    for (const slice of slices) {
      assert.ok(jsonByteLength(slice) <= IMPORT_PAYLOAD_SLICE_BYTES);
    }
    assert.equal(slices.flat().length, rows.length);
  });
});
