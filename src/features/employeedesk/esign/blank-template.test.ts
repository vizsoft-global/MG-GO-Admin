import assert from "node:assert/strict";
import { test } from "node:test";

import { blankEsignTemplate, resolveEsignCategoryKey } from "./blank-template";
import { ESIGN_DOCUMENT_KINDS } from "@/features/esign/types";

/**
 * The categories the panel actually serves today, read from `esign_categories` on
 * `eoksxkdssptgyqyywdju`. `penalty` is deliberately absent, because that absence is
 * the defect these cases exist for.
 */
const LIVE = [
  { key: "tst" },
  { key: "accommodation" },
  { key: "salary_slips" },
  { key: "administrative" },
  { key: "asset_docs" },
  { key: "traffic" },
  { key: "unexcused_absence" },
  { key: "other" },
  { key: "loan_agreement" },
  { key: "asset_handover" },
];

test("an orphaned category key resolves to a live one", () => {
  // `penalty` is not a row in `esign_categories`, and the picker paints an unmatched
  // value as its raw text — so this is the case that printed the literal "penalty".
  assert.equal(resolveEsignCategoryKey("penalty", LIVE), "tst");
  assert.equal(resolveEsignCategoryKey("warning", LIVE), "tst");
  assert.equal(resolveEsignCategoryKey("loan", LIVE), "tst");
});

test("a live category key is preserved exactly", () => {
  assert.equal(resolveEsignCategoryKey("administrative", LIVE), "administrative");
  assert.equal(resolveEsignCategoryKey("asset_handover", LIVE), "asset_handover");
});

test("a key is matched after trimming, and a blank never wins", () => {
  assert.equal(resolveEsignCategoryKey("  traffic ", LIVE), "traffic");
  assert.equal(resolveEsignCategoryKey("", LIVE), "tst");
  assert.equal(resolveEsignCategoryKey("   ", LIVE), "tst");
  assert.equal(resolveEsignCategoryKey(null, LIVE), "tst");
  assert.equal(resolveEsignCategoryKey(undefined, LIVE), "tst");
});

test("an empty catalogue yields an empty string, never an invented option", () => {
  // The failure this guards is the old hardcoded fallback list: five keys, none of
  // them real rows, so the picker offered a category the FK would refuse on save.
  assert.equal(resolveEsignCategoryKey("penalty", []), "penalty");
  assert.equal(resolveEsignCategoryKey("", []), "");
  assert.equal(resolveEsignCategoryKey(undefined, []), "");
});

test("the blank seed names no category, so it cannot become an orphan", () => {
  const seed = blankEsignTemplate();
  assert.equal(seed.category_key, "");
  assert.equal(seed.id, "", "create mode is keyed on an absent id");
});

test("the blank seed still describes a document the renderer supports", () => {
  const seed = blankEsignTemplate();
  assert.ok(
    ESIGN_DOCUMENT_KINDS.includes(seed.document_kind),
    `seed document_kind ${seed.document_kind} is not renderable`,
  );
  assert.ok(seed.body_en.length > 0 && seed.body_ar.length > 0);
  assert.ok(seed.declaration_en.length > 0 && seed.declaration_ar.length > 0);
});
