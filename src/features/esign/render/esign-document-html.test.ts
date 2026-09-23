import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEsignDocumentHtml,
  sampleEmployee,
  SIGNATURE_BAND_PT,
} from "./esign-document-html";

const fields = [
  { key: "penalty_date", label: "Penalty date", value: "2026-09-01" },
  { key: "decision", label: "Decision", value: "Warning" },
];

function base(language: "en" | "ar") {
  return buildEsignDocumentHtml({
    language,
    header: "Notice for {{employee_name}}",
    body: "Company {{company_name}} / ID {{employee_id}}",
    declaration: "I acknowledge.",
    description: "Late return",
    fields,
    employee: sampleEmployee(),
  });
}

describe("buildEsignDocumentHtml", () => {
  it("uses dir=ltr for EN and dir=rtl for AR", () => {
    const en = base("en");
    const ar = base("ar");
    assert.match(en, /lang="en" dir="ltr"/);
    assert.match(ar, /lang="ar" dir="rtl"/);
  });

  it("keeps the same employee block fields on EN and AR", () => {
    const en = base("en");
    const ar = base("ar");
    for (const html of [en, ar]) {
      assert.match(html, /data-employee-block="1"/);
      assert.match(html, /Musallam Delivery/);
      assert.match(html, /Ahmed Ali/);
      assert.match(html, /10421/);
    }
  });

  it("escapes injected field HTML", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      header: "{{note}}",
      body: "",
      declaration: "",
      description: "",
      fields: [],
      employee: sampleEmployee(),
      // note is not an employee key — comes from merged field values via header token only
    });
    const injected = buildEsignDocumentHtml({
      language: "en",
      header: "Hi {{employee_name}}",
      body: "",
      declaration: "",
      description: "",
      fields: [{ key: "x", label: "X", value: "<script>alert(1)</script>" }],
      employee: sampleEmployee({ employee_name: "<img>" }),
    });
    assert.doesNotMatch(html, /<script>/);
    assert.match(injected, /&lt;img&gt;/);
    assert.match(injected, /&lt;script&gt;/);
  });

  it("reserves the signature band", () => {
    const html = base("en");
    assert.match(html, /data-signature-band="1"/);
    assert.match(html, new RegExp(`height: ${SIGNATURE_BAND_PT}pt`));
  });
});
