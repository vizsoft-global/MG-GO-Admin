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

/** The employee block only — assertions about placement must not see the body. */
function employeeBlockOf(html: string): string {
  const start = html.indexOf('<section class="employee-block"');
  const end = html.indexOf("</section>", start);
  assert.ok(start >= 0 && end > start, "employee block not found");
  return html.slice(start, end);
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

  it("prints the core employee rows even when the record has nothing else", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      header: "",
      body: "",
      declaration: "",
      description: "",
      fields: [],
      employee: sampleEmployee({
        company_name: "DPD",
        employee_name: "Bare Record",
        employee_id: "10099",
        driver_code: "",
        civil_id: null,
        joined_at: null,
        accommodation: null,
        zone: null,
        project: null,
        nationality: null,
      }),
    });
    const block = employeeBlockOf(html);
    assert.match(block, /Bare Record/);
    assert.match(block, /10099/);
    // A rider with no civil ID must not get "Civil ID —" on a document a person
    // signs; the row is absent, not blank.
    assert.doesNotMatch(block, /Civil ID/);
    assert.doesNotMatch(block, /Joining date/);
    assert.doesNotMatch(block, /Accommodation/);
  });

  it("prints the record rows when the rider has them, in catalogue order", () => {
    const block = employeeBlockOf(base("en"));
    const civil = block.indexOf("Civil ID");
    const joined = block.indexOf("Joining date");
    const accommodation = block.indexOf("Accommodation");
    assert.ok(civil >= 0 && joined >= 0 && accommodation >= 0);
    assert.ok(civil < joined, "Civil ID should print before Joining date");
    assert.ok(joined < accommodation, "Joining date should print before Accommodation");
  });

  it("translates the employee block labels", () => {
    const block = employeeBlockOf(base("ar"));
    assert.match(block, /الرقم المدني/);
    assert.match(block, /تاريخ الانضمام/);
  });

  it("prints an authored employee-section row inside the block, not under Details", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      header: "",
      body: "",
      declaration: "",
      description: "",
      fields: [
        { key: "sponsor_note", label: "Sponsor note", value: "HR-4", section: "employee" },
        { key: "penalty_date", label: "Penalty date", value: "2026-09-01", section: "document" },
      ],
      employee: sampleEmployee(),
    });
    const block = employeeBlockOf(html);
    assert.match(block, /Sponsor note/);
    assert.match(block, /HR-4/);
    assert.doesNotMatch(block, /Penalty date/);
    assert.match(html, /Penalty date/);
  });

  it("treats a field with no section as a document row", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      header: "",
      body: "",
      declaration: "",
      description: "",
      fields: [{ key: "x", label: "Legacy row", value: "v" }],
      employee: sampleEmployee(),
    });
    assert.doesNotMatch(employeeBlockOf(html), /Legacy row/);
  });

  it("fills the reserved band with the bottom skeleton instead of leaving it empty", () => {
    const html = base("en");
    const band = html.slice(html.indexOf('data-signature-band="1"'));
    assert.match(band, /Employee Authorized signature/);
    assert.match(band, /HR signature/);
    assert.match(band, /Management Use Only/);
    assert.match(band, /CEO Decision/);
    assert.match(band, /Approved/);
    assert.match(band, /Not approved/);
    assert.match(band, /HR \/ Admin Department/);
    assert.match(band, /General Manager/);
    assert.match(band, /Approval Status/);
    assert.match(band, /Decision/);
  });

  it("translates the bottom skeleton", () => {
    const html = base("ar");
    const band = html.slice(html.indexOf('data-signature-band="1"'));
    assert.match(band, /للاستخدام الإداري فقط/);
    assert.match(band, /قرار الرئيس التنفيذي/);
    assert.match(band, /المدير العام/);
  });

  it("keeps the band out of the region the signature is stamped into", () => {
    // The signed copy is composited at absolute coordinates in the bottom-right
    // of the last page (esign-compose-stamp.ts). 56% of the A4 text column
    // leaves ~230pt clear, and the stamp needs at most 216pt.
    const html = base("en");
    assert.match(html, /max-width: 56%/);
    const bandHeight = Number(/height: (\d+)pt/.exec(html)?.[1]);
    assert.equal(bandHeight, SIGNATURE_BAND_PT);
  });
});
