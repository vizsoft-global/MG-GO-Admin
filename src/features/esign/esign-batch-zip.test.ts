import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveExtension,
  archiveNameFallback,
  esignArchiveFilename,
  esignArchiveName,
  planEsignZipEntries,
  sanitizeArchiveSegment,
} from "./esign-batch-zip";

const row = (over: Partial<Parameters<typeof esignArchiveName>[0]> = {}) => ({
  row_index: 0,
  employee_id: "10001",
  request_code: "SIG-0001",
  driver_name: "Ali Hassan",
  signed_key: "signed/bat/1.pdf",
  ...over,
});

test("sanitize drops path separators and control characters", () => {
  assert.equal(sanitizeArchiveSegment("a/b\\c:d*e?f"), "a b c d e f");
  assert.equal(sanitizeArchiveSegment("  Ali   Hassan  "), "Ali Hassan");
  assert.equal(sanitizeArchiveSegment("..hidden"), "hidden");
  assert.equal(sanitizeArchiveSegment("x".repeat(200)).length, 80);
});

test("name leads with Employee ID, then request code, then the rider", () => {
  assert.equal(esignArchiveName(row(), "pdf"), "10001 - SIG-0001 - Ali Hassan.pdf");
});

test("a missing part is skipped rather than leaving a separator", () => {
  assert.equal(esignArchiveName(row({ driver_name: null }), "pdf"), "10001 - SIG-0001.pdf");
  assert.equal(esignArchiveName(row({ employee_id: null, driver_name: null }), "pdf"), "SIG-0001.pdf");
});

test("a row with nothing usable falls back to its position", () => {
  const empty = row({ employee_id: null, request_code: null, driver_name: null, row_index: 4 });
  assert.equal(esignArchiveName(empty, "pdf"), `${archiveNameFallback(4)}.pdf`);
});

test("extension follows the stored key, and anything unknown becomes pdf", () => {
  assert.equal(archiveExtension("a/b/c.png"), "png");
  assert.equal(archiveExtension("a/b/c.JPEG"), "jpg");
  assert.equal(archiveExtension("a/b/c.pdf"), "pdf");
  assert.equal(archiveExtension("a/b/c.exe"), "pdf");
  assert.equal(archiveExtension("a/b/c"), "pdf");
  assert.equal(archiveExtension("a/b/.hidden"), "pdf");
});

test("rows without a signed document are not archived", () => {
  const plan = planEsignZipEntries([
    row({ signed_key: null }),
    row({ signed_key: "  " }),
    row({ row_index: 1, signed_key: "signed/1.pdf" }),
  ]);
  assert.deepEqual(plan.map((p) => p.storage_key), ["signed/1.pdf"]);
});

test("colliding names are suffixed instead of overwriting each other", () => {
  const plan = planEsignZipEntries([
    row({ signed_key: "signed/a.pdf" }),
    row({ signed_key: "signed/b.pdf" }),
    row({ signed_key: "signed/c.png" }),
  ]);
  assert.deepEqual(plan.map((p) => p.name), [
    "10001 - SIG-0001 - Ali Hassan.pdf",
    "10001 - SIG-0001 - Ali Hassan (2).pdf",
    // A different extension is a different name, so it is not suffixed.
    "10001 - SIG-0001 - Ali Hassan.png",
  ]);
});

test("an Arabic rider name is kept verbatim in the plan", () => {
  const plan = planEsignZipEntries([row({ driver_name: "علي حسن" })]);
  assert.deepEqual(plan.map((p) => p.name), ["10001 - SIG-0001 - علي حسن.pdf"]);
});

test("the archive filename falls back from batch code to title to a constant", () => {
  assert.equal(esignArchiveFilename("BAT-0041", "Anything"), "BAT-0041-signed.zip");
  assert.equal(esignArchiveFilename(null, "March contracts"), "March contracts-signed.zip");
  assert.equal(esignArchiveFilename(null, null), "esign-signed.zip");
  assert.equal(esignArchiveFilename("  ", "   "), "esign-signed.zip");
});
