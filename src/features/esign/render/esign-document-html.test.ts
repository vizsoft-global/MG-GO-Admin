import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEsignDocumentHtml,
  sampleEmployee,
} from "./esign-document-html";
import { isBottomRightFallback, resolveEmployeeStampSlot } from "./esign-document-layout";

const fields = [
  { key: "penalty_date", label: "Penalty date", labelEn: "Penalty date", labelAr: "تاريخ الجزاء", value: "2026-09-01" },
  { key: "decision", label: "Decision", labelEn: "Decision", labelAr: "القرار", value: "Warning" },
];

function base(language: "en" | "ar") {
  return buildEsignDocumentHtml({
    language,
    kind: "penalty",
    headerEn: "Notice for {{employee_name}}",
    headerAr: "إشعار لـ {{employee_name}}",
    bodyEn: "Company {{company_name}} / ID {{employee_id}}",
    bodyAr: "الشركة {{company_name}} / {{employee_id}}",
    declarationEn: "I acknowledge.",
    declarationAr: "أقر بذلك.",
    description: "Late return",
    fields,
    employee: sampleEmployee(),
  });
}

function employeeBlockOf(html: string): string {
  const start = html.indexOf('<section class="employee-block"');
  const end = html.indexOf("</section>", start);
  assert.ok(start >= 0 && end > start, "employee block not found");
  return html.slice(start, end);
}

describe("buildEsignDocumentHtml", () => {
  it("never sets html dir=rtl — Arabic is per-span", () => {
    const en = base("en");
    const ar = base("ar");
    assert.match(en, /lang="en" dir="ltr"/);
    assert.match(ar, /lang="en" dir="ltr"/);
    assert.doesNotMatch(en, /<html[^>]*dir="rtl"/);
    assert.doesNotMatch(ar, /<html[^>]*dir="rtl"/);
    assert.match(en, /dir="rtl"/);
    assert.match(ar, /إشعار جزاء|إشعار لـ/);
  });

  it("prints both English and Arabic on one sheet", () => {
    const html = base("en");
    assert.match(html, /Penalty Notice|Notice for Ahmed Ali/);
    assert.match(html, /إشعار/);
    assert.match(html, /Employee Name/);
    assert.match(html, /اسم الموظف/);
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

  it("draws named signature slots instead of a 56% bottom-right band", () => {
    const html = base("en");
    assert.match(html, /data-signature-band="1"/);
    assert.match(html, /data-slot-role="employee"/);
    assert.match(html, /data-slot-role="hr"/);
    assert.doesNotMatch(html, /max-width: 56%/);
    const employee = resolveEmployeeStampSlot({ kind: "penalty" });
    assert.equal(isBottomRightFallback(employee), false);
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
    assert.doesNotMatch(block, /Civil ID/);
    assert.doesNotMatch(block, /Joining date/);
    assert.doesNotMatch(block, /Accommodation/);
  });

  it("prints the record rows when the rider has them, in catalogue order", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      header: "",
      body: "",
      declaration: "",
      description: "",
      fields: [],
      employee: sampleEmployee(),
    });
    const block = employeeBlockOf(html);
    const civil = block.indexOf("Civil ID");
    const joined = block.indexOf("Joining date");
    const accommodation = block.indexOf("Accommodation");
    assert.ok(civil >= 0 && joined >= 0 && accommodation >= 0);
    assert.ok(civil < joined, "Civil ID should print before Joining date");
    assert.ok(joined < accommodation, "Joining date should print before Accommodation");
  });

  it("prints Arabic employee labels on the same page", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      header: "",
      body: "",
      declaration: "",
      description: "",
      fields: [],
      employee: sampleEmployee(),
    });
    const block = employeeBlockOf(html);
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

  it("fills the reserved band with named slots and the management box", () => {
    const html = base("en");
    assert.match(html, /data-signature-band="1"/);
    assert.match(html, /data-slot-role="employee"/);
    assert.match(html, /data-slot-role="hr"/);
    assert.match(html, /data-slot-role="gm"/);
    assert.match(html, /Employee Signature/);
    assert.match(html, /توقيع الموظف/);
    assert.match(html, /Management Use Only/);
    assert.match(html, /HR \/ Admin Department/);
    assert.match(html, /General Manager/);
    assert.match(html, /Form Ref\.: MG HR Ref Emp\. 0011/);
    assert.doesNotMatch(html, /max-width: 56%/);
  });

  it("prints a penalty opening paragraph, declaration, leftover field, and author sign labels", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      kind: "penalty",
      header: "Penalty",
      body: "Please read this notice.",
      declaration: "I acknowledge.",
      description: "",
      fields: [
        { key: "penalty_action", labelEn: "Action", labelAr: "الإجراء", value: "Warning" },
        {
          key: "employee_signature",
          labelEn: "Employee Sign",
          labelAr: "توقيع الموظف",
          value: "",
          source: "signature",
        },
      ],
      employee: sampleEmployee(),
    });
    assert.match(html, /data-section="opening"/);
    assert.match(html, /Opening paragraph/);
    assert.match(html, /Please read this notice\./);
    assert.match(html, /data-section="declaration"/);
    assert.match(html, /I acknowledge\./);
    assert.match(html, /Warning/);
    assert.match(html, /Employee Sign/);
  });

  it("prints a general opening paragraph and a named signature caption", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      header: "Leave",
      body: "Leave starts Monday.",
      declaration: "I confirm.",
      description: "",
      fields: [
        {
          key: "employee_signature",
          labelEn: "Employee Sign",
          labelAr: "توقيع الموظف",
          value: "",
          source: "signature",
        },
      ],
      employee: sampleEmployee(),
    });
    assert.match(html, /data-section="opening"/);
    assert.match(html, /Leave starts Monday\./);
    assert.match(html, /I confirm\./);
    assert.match(html, /Employee Sign/);
    assert.doesNotMatch(html, /data-section="author_signs"/);
  });

  it("prints Arabic section captions without flipping the page", () => {
    const html = base("ar");
    assert.match(html, /بيانات الموظف/);
    assert.match(html, /تفاصيل المخالفة/);
    assert.match(html, /الجزاء/);
    assert.match(html, /lang="en" dir="ltr"/);
    assert.doesNotMatch(html, /<html[^>]*dir="rtl"/);
  });

  it("keeps the classic management labels on a general document", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      header: "Note",
      body: "",
      declaration: "",
      description: "",
      fields: [],
      employee: sampleEmployee(),
    });
    assert.match(html, /Employee Authorized signature/);
    assert.match(html, /Management Use Only/);
    assert.match(html, /CEO Decision/);
    assert.match(html, /للاستخدام الإداري فقط/);
    assert.match(html, /قرار الرئيس التنفيذي/);
  });

  it("prints a payslip identity grid and amount table without a bottom stamp", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      kind: "payslip",
      headerEn: "Salary Slip — August 2026",
      headerAr: "قسيمة راتب",
      bodyEn: "",
      bodyAr: "",
      declarationEn: "",
      declarationAr: "",
      fields: [
        { key: "actual_working_days", label: "Actual Working Days", labelEn: "Actual Working Days", labelAr: "أيام العمل الفعلية", value: "26" },
        { key: "net_salary_kwd", label: "Net Salary", labelEn: "Net Salary", labelAr: "صافي الراتب", value: "245.000" },
      ],
      employee: sampleEmployee({
        company_name: "MGGO Logistics LLC",
        bank_number: "KW81XXXX1041",
        position: "Rider",
      }),
    });
    assert.match(html, /data-payslip="identity"/);
    assert.match(html, /data-payslip="sheet"/);
    assert.match(html, /Code \/ Name/);
    assert.match(html, /الرمز \/ الاسم/);
    assert.match(html, /MGGO Logistics LLC/);
    assert.match(html, /KW81…1041/);
    assert.match(html, /data-payslip-line="actual_working_days"/);
    assert.match(html, /data-tone="net"/);
    assert.match(html, /1\.00/);
    assert.doesNotMatch(html, /data-management="1"/);
    assert.doesNotMatch(html, /data-section="opening"/);
    assert.doesNotMatch(html, /data-section="declaration"/);
    assert.match(html, /data-signature-band="1"/);
    assert.match(html, /Employee Sign/);
    assert.match(html, /Management Sign/);
    assert.match(html, /توقيع الموظف/);
    assert.match(html, /توقيع الإدارة/);
  });

  it("prints the payslip opening paragraph, declaration, extra fields, and named sign boxes", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      kind: "payslip",
      headerEn: "Payslip",
      bodyEn: "This slip covers the month.",
      bodyAr: "هذه القسيمة للشهر.",
      declarationEn: "I received this payslip.",
      declarationAr: "استلمت هذه القسيمة.",
      fields: [
        {
          key: "admin_deduction",
          label: "Admin deduction",
          labelEn: "Admin deduction",
          labelAr: "خصم",
          value: "12.000",
          source: "entry",
        },
        {
          key: "open_note",
          label: "Open note",
          labelEn: "Open note",
          labelAr: "ملاحظة",
          value: "Night shift",
          source: "entry",
        },
        {
          key: "employee_signature",
          label: "Employee Sign",
          labelEn: "Employee Sign",
          labelAr: "توقيع الموظف",
          value: "",
          source: "signature",
        },
        {
          key: "management_signature",
          label: "Management Sign",
          labelEn: "Management Sign",
          labelAr: "توقيع الإدارة",
          value: "",
          source: "signature",
        },
      ],
      employee: sampleEmployee(),
    });
    assert.match(html, /data-section="opening"/);
    assert.match(html, /This slip covers the month/);
    assert.match(html, /data-section="declaration"/);
    assert.match(html, /I received this payslip/);
    assert.match(html, /data-section="payslip_extra"/);
    assert.match(html, /Night shift/);
    assert.match(html, /data-payslip-line="deduction_amount_kwd"/);
    assert.match(html, /12\.000/);
    assert.match(html, /data-slot-role="employee"/);
    assert.match(html, /data-slot-role="hr"/);
    assert.doesNotMatch(html, /data-management="1"/);
  });
});
