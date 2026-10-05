import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ESIGN_BOTTOM_LABELS } from "../../esign/render/esign-document-html";

/**
 * The live preview and the delivered document have to say the same words.
 *
 * This is the one invariant the template builder cannot check by construction,
 * because the two surfaces deliberately do not share a string source: the
 * preview is React following the *operator's* UI locale, and the document is
 * HTML generated in the *template's* own locale. Each is right on its own, and
 * together they had already drifted — the preview read "Employee signature"
 * and "Date" where the PDF a rider receives reads "Employee Authorized
 * signature" and "Signature and date". Both are valid strings, both render
 * fine, and the only person who could notice was an operator holding the two
 * side by side, which is exactly the comparison the reference PDF asks for.
 *
 * So the contract is asserted rather than assumed, message-catalogue against
 * renderer, in both locales. A reword has to happen in both places at once or
 * this test fails and names the pair — which is the point.
 */

const ROOT = process.cwd();

type Catalogue = Record<string, unknown>;

function read(locale: "en" | "ar"): Catalogue {
  const file = path.join(ROOT, "src", "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Catalogue;
}

function at(source: unknown, ...trail: string[]): unknown {
  let cursor: unknown = source;
  for (const step of trail) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[step];
  }
  return cursor;
}

const TEMPLATE_BUILDER = [
  "pages",
  "employeedesk",
  "esign",
  "templateBuilder",
] as const;

/** Renderer key → the builder namespace key that has to carry the same text. */
const PAIRS: readonly [keyof (typeof ESIGN_BOTTOM_LABELS)["en"], string][] = [
  ["employeeSignature", "previewEmployeeSignature"],
  ["staffSignature", "previewStaffSignature"],
  // The date hint lives inside the `preview` group rather than beside the two
  // slot labels, because the preview passes it down as `SignatureBlock`'s
  // default note while the slot labels arrive as props.
  ["signatureDate", "preview.signatureDate"],
  ["managementUseOnly", "preview.managementUseOnly"],
  ["ceoDecision", "preview.ceoDecision"],
  ["approved", "preview.approved"],
  ["notApproved", "preview.notApproved"],
  ["hrAdmin", "preview.hrAdminDepartment"],
  ["generalManager", "preview.generalManager"],
  ["approvalStatus", "preview.approvalStatus"],
  ["decision", "preview.decision"],
];

for (const locale of ["en", "ar"] as const) {
  test(`${locale}: the preview prints the signature band the document prints`, () => {
    const messages = read(locale);
    const band = ESIGN_BOTTOM_LABELS[locale];

    for (const [rendererKey, builderKey] of PAIRS) {
      const expected = band[rendererKey];
      const actual = at(messages, ...TEMPLATE_BUILDER, ...builderKey.split("."));
      assert.equal(
        actual,
        expected,
        `${locale}: preview "${builderKey}" is ${JSON.stringify(actual)} but the document prints ${JSON.stringify(expected)}`,
      );
    }
  });
}

test("the band carries both a signature slot and the management box", () => {
  // A guard on the guard: if someone empties the map the comparison above
  // passes vacuously for every pair it no longer contains.
  assert.ok(PAIRS.length >= 8, "the pair list must still cover the band");
  for (const locale of ["en", "ar"] as const) {
    assert.ok(ESIGN_BOTTOM_LABELS[locale].employeeSignature.length > 0);
    assert.ok(ESIGN_BOTTOM_LABELS[locale].staffSignature.length > 0);
    assert.ok(ESIGN_BOTTOM_LABELS[locale].managementUseOnly.length > 0);
  }
});

test("no preview label is English text under the Arabic catalogue", () => {
  // Arabic must not fall back to the Latin label: `request.ts` sets no
  // `fallbackLocale`, so a missing key renders as the key itself, and an
  // untranslated copy renders as English on an otherwise mirrored page.
  const messages = read("ar");
  for (const [, builderKey] of PAIRS) {
    const value = at(messages, ...TEMPLATE_BUILDER, ...builderKey.split("."));
    assert.equal(typeof value, "string", `ar: ${builderKey} is not a string`);
    assert.match(
      value as string,
      /[\u0600-\u06FF]/,
      `ar: ${builderKey} has no Arabic characters — it is ${JSON.stringify(value)}`,
    );
  }
});
