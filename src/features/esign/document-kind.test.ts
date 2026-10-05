import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeDocumentKind } from "./document-kind";
import { ESIGN_DOCUMENT_KINDS } from "./types";

/**
 * The regression these pin is not "does `payslip` work" — it is that a kind the
 * database accepts must survive the read path.
 *
 * `mapTemplate` held its own `["penalty", "loan", "general"]` allowlist and
 * rewrote everything else to `general`, so a payslip template fetched from
 * Postgres arrived at the builder as a plain body. The database, the type union
 * and the picker had all been taught `payslip`; one list had not, and the screen
 * drew a document skeleton nobody had chosen while still looking like a working
 * builder. Nothing failed, so nothing was noticed until the preview was held
 * against panel C2 of the reference.
 */
describe("normalizeDocumentKind", () => {
  it("passes every canonical kind through unchanged", () => {
    // Driven off the canonical list rather than a copy of it, so a kind added
    // there cannot arrive here untested.
    for (const kind of ESIGN_DOCUMENT_KINDS) {
      assert.equal(normalizeDocumentKind(kind), kind);
    }
  });

  it("keeps payslip, which is the kind the second allowlist dropped", () => {
    assert.equal(normalizeDocumentKind("payslip"), "payslip");
  });

  it("keeps the three kinds the removed inline list knew about", () => {
    assert.equal(normalizeDocumentKind("penalty"), "penalty");
    assert.equal(normalizeDocumentKind("loan"), "loan");
    assert.equal(normalizeDocumentKind("general"), "general");
  });

  it("maps anything outside the canonical list to general", () => {
    assert.equal(normalizeDocumentKind("nda"), "general");
    // The database CHECK is an exact match, so a row can only hold the canonical
    // spelling. Accepting `Payslip` here would hide a write path that is
    // bypassing the constraint rather than fixing it.
    assert.equal(normalizeDocumentKind("Payslip"), "general");
    assert.equal(normalizeDocumentKind(" payslip "), "general");
  });

  it("falls back to general for a missing value", () => {
    assert.equal(normalizeDocumentKind(null), "general");
    assert.equal(normalizeDocumentKind(undefined), "general");
    assert.equal(normalizeDocumentKind(""), "general");
  });
});
