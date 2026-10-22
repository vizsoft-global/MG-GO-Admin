import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEsignDocumentHtml,
  sampleEmployee,
} from "./esign-document-html";
import { isBottomRightFallback, resolveEmployeeStampSlot } from "./esign-document-layout";
import { filledEsignDocumentInput } from "./esign-filled-sheet";

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
  it("prints the accident declaration, commitment list and rider name", () => {
    const input = filledEsignDocumentInput({
      template: {
        document_kind: "general",
        header_en: "Accident",
        header_ar: "حادث",
        body_en: "Accident report",
        body_ar: "تقرير حادث",
        declaration_en: "",
        declaration_ar: "",
        fields: [
          {
            field_key: "request_kind",
            label_en: "Request kind",
            label_ar: "نوع الطلب",
            section_key: "document",
            source_kind: "entry",
            options: ["accident", "sick_leave"],
          },
        ],
      },
      snapshot: sampleEmployee(),
      fieldValues: {
        request_kind: "accident",
        accident_date: "2026-10-18",
        report_date: "2026-10-19",
        rider_name: "Ahmed Ali",
      },
      description: "",
    });
    const html = buildEsignDocumentHtml(input);
    assert.match(html, /acc-tail/);
    assert.match(html, /Rider Name/);
    assert.match(html, /Ahmed Ali/);
    assert.match(html, /Police traffic report/);
    assert.match(html, /Initial medical report/);
    assert.match(html, /data-slot-role="employee"/);
    // The reference is a declaration sheet, not a dated incident report.
    assert.doesNotMatch(html, /Accident date/);
    assert.doesNotMatch(html, /2026-10-18/);
  });

  it("prints long sheets across two pages without splitting boxes", () => {
    const html = base("en");
    assert.match(html, /@media print \{/);
    assert.match(
      html,
      /\.page \{ height: auto; min-height: 297mm; overflow: visible; break-after: page;/,
    );
    assert.match(html, /\.page-fit \{ overflow: visible; \}/);
    assert.match(html, /\.sheet-dock\{flex:none; break-inside: avoid;/);
    assert.match(html, /tr \{ break-inside: avoid; page-break-inside: avoid; \}/);
  });

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
    assert.match(html, /Document ID/);
    assert.doesNotMatch(html, /Form Ref:/);
    assert.doesNotMatch(html, /Page 1 of 1/);
    assert.doesNotMatch(html, /max-width: 56%/);
  });

  it("prints the request code as Document ID on the generic kinds", () => {
    for (const kind of ["penalty", "general"] as const) {
      const html = buildEsignDocumentHtml({
        language: "en",
        kind,
        headerEn: "Sheet",
        employee: sampleEmployee(),
        requestCode: "SIG-1428",
      });
      assert.match(html, /Document ID/);
      assert.match(html, /رقم المستند/);
      assert.match(html, /SIG-1428/);
      assert.doesNotMatch(html, /Form Ref:/);
      assert.doesNotMatch(html, /Page 1 of 1/);
      assert.doesNotMatch(html, /Generated by MGGO DPD/);
      assert.doesNotMatch(html, /Slip No\./);
      assert.doesNotMatch(html, /Notice No\./);
      assert.doesNotMatch(html, /Request No\./);
    }
    // The three signed-off reference sheets have no meta strip by design.
    for (const kind of ["loan", "payslip"] as const) {
      const html = buildEsignDocumentHtml({
        language: "en",
        kind,
        headerEn: "Sheet",
        employee: sampleEmployee(),
        requestCode: "SIG-1428",
      });
      assert.doesNotMatch(html, /Document ID/);
    }
    const html = buildEsignDocumentHtml({
      language: "en",
      kind: "general",
      headerEn: "Sheet",
      employee: sampleEmployee(),
      requestCode: "SIG-1428",
    });
    assert.match(employeeBlockOf(html), /10421/);
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
    assert.match(html, /class="page-fit"/);
    assert.match(html, /297mm/);
    assert.doesNotMatch(html, /min-height: 841\.89pt/);
    assert.match(html, /Opening paragraph/);
    assert.match(html, /Please read this notice\./);
    assert.match(html, /data-section="declaration"/);
    assert.match(html, /I acknowledge\./);
    assert.match(html, /Warning/);
    assert.match(html, /Employee Sign/);
  });

  it("prints only visible penalty checks and ticks every selected row", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      kind: "penalty",
      header: "Penalty",
      fields: [
        {
          key: "penalty_action",
          label: "Action",
          labelEn: "Action",
          labelAr: "الإجراء",
          value: "Written warning",
          options: ["Written warning", "Others"],
        },
      ],
      employee: sampleEmployee(),
    });
    assert.match(html, /data-check-key="written_warning"/);
    assert.match(html, /data-check-key="others"/);
    assert.match(html, /class="cb on"/);
    assert.doesNotMatch(html, /One day deduction/);
    assert.doesNotMatch(html, /figma_geom_mismatch/);
  });

  it("ticks two selected penalty checks on one document", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      kind: "penalty",
      header: "Penalty",
      fields: [
        {
          key: "penalty_action",
          labelEn: "Action",
          labelAr: "الإجراء",
          value: "Written warning, One day deduction",
          options: ["Written warning", "One day deduction", "Others"],
        },
      ],
      employee: sampleEmployee(),
    });
    assert.match(html, /class="cb on" data-check-key="written_warning"/);
    assert.match(html, /class="cb on" data-check-key="deduct_1_day"/);
    assert.match(html, /data-check-key="others"/);
    assert.doesNotMatch(html, /class="cb on" data-check-key="others"/);
    assert.doesNotMatch(html, /figma_geom_mismatch/);
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
    assert.match(html, /page-fit/);
    assert.match(html, /297mm/);
    assert.doesNotMatch(html, /min-height: 841\.89pt/);
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
    assert.match(html, /Employee Signature/);
    assert.match(html, /Management Use Only/);
    assert.match(html, /HR \/ Admin Department/);
    assert.match(html, /للاستخدام الإداري فقط/);
    assert.doesNotMatch(html, /CEO Decision/);
  });

  it("prints the reference payslip grid, line table and signature pair", () => {
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
    assert.match(html, /pay-grid/);
    assert.match(html, /pay-lines/);
    assert.match(html, /Salary Slip/);
    assert.match(html, /MGGO Logistics LLC/);
    assert.match(html, /KW81XXXX1041/);
    assert.match(html, /Actual Working Days/);
    assert.match(html, /Net Salary/);
    assert.match(html, /Employee signature/);
    assert.match(html, /Authorized signature/);
    assert.match(html, /توقيع الموظف/);
    assert.match(html, /المفوض بالتوقيع/);
    assert.match(html, /data-slot-role="employee"/);
    assert.match(html, /data-slot-role="hr"/);
    assert.doesNotMatch(html, /data-management="1"/);
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
    assert.match(html, /page-fit/);
    assert.doesNotMatch(html, /data-section="opening"/);
    assert.doesNotMatch(html, /This slip covers the month/);
    assert.match(html, /I received this payslip/);
    assert.match(html, /pay-extra/);
    assert.match(html, /Night shift/);
    assert.doesNotMatch(html, /data-logo="1"/);
    assert.match(html, /Administration deduction/);
    assert.match(html, /12\.00 KD/);
    assert.match(html, /data-slot-role="employee"/);
    assert.match(html, /data-slot-role="hr"/);
    assert.doesNotMatch(html, /data-management="1"/);
  });

  it("inserts a logo and a two-column management grid, and skips empty leftover dump", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      kind: "penalty",
      headerEn: "Penalty Notice",
      headerAr: "إشعار جزاء",
      bodyEn: "Penalty notice",
      bodyAr: "إشعار جزاء",
      fields: [
        { key: "others_amount", labelEn: "Others amount", labelAr: "مبلغ آخر", value: "" },
        { key: "optional_remark", labelEn: "Optional remark", labelAr: "ملاحظة اختيارية", value: "" },
      ],
      employee: sampleEmployee(),
    });
    assert.doesNotMatch(html, /data-logo="1"/);
    assert.doesNotMatch(html, /class="logo-img"/);
    assert.match(html, /HR \/ Admin Department/);
    assert.match(html, /إدارة الموارد البشرية \/ الإدارة/);
    assert.match(html, /Document ID/);
    assert.doesNotMatch(html, /Form Ref:/);
    assert.doesNotMatch(html, /Page 1 of 1/);
    assert.doesNotMatch(html, />Logo</);
    assert.doesNotMatch(html, /Others amount/);
    assert.doesNotMatch(html, /Optional remark/);
    assert.doesNotMatch(html, /Opening paragraph/);
  });

  it("stacks general management and prints a sheet foot without empty leftovers", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      kind: "general",
      headerEn: "Asset Request",
      headerAr: "طلب أصل",
      bodyEn: "Asset Request",
      bodyAr: "طلب أصل",
      fields: [
        { key: "empty_note", labelEn: "Empty note", labelAr: "ملاحظة فارغة", value: "" },
        { key: "title_echo", labelEn: "Title echo", labelAr: "صدى", value: "Asset Request" },
      ],
      employee: sampleEmployee(),
    });
    assert.match(html, /data-management="1"/);
    assert.match(html, /data-sheet-foot="1"/);
    assert.doesNotMatch(html, /data-logo="1"/);
    assert.match(html, /mgmt-signs/);
    assert.match(html, /Document ID/);
    assert.doesNotMatch(html, /Form Ref:/);
    assert.doesNotMatch(html, /Page 1 of 1/);
    assert.doesNotMatch(html, />Logo</);
    assert.doesNotMatch(html, /Empty note/);
    assert.doesNotMatch(html, /Title echo/);
    assert.doesNotMatch(html, /data-section="opening"/);
  });

  it("prints the reference loan sheet without a generic foot", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      kind: "loan",
      headerEn: "Loan Request",
      headerAr: "طلب قرض",
      employee: sampleEmployee(),
    });
    assert.match(html, /loan-page/);
    assert.match(html, /Employee Information/);
    assert.match(html, /Loan Request/);
    assert.match(html, /HR Verification/);
    assert.match(html, /Management Decision/);
    assert.match(html, /data-slot-role="employee"/);
    assert.match(html, /data-slot-role="hr"/);
    assert.doesNotMatch(html, /data-sheet-foot="1"/);
    assert.doesNotMatch(html, /data-logo="1"/);
    assert.doesNotMatch(html, /Document ID/);
    assert.doesNotMatch(html, />Logo</);
  });

  it("prints the reference payslip without a management box", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      kind: "payslip",
      headerEn: "Payslip",
      employee: sampleEmployee(),
    });
    assert.match(html, /pay-page/);
    assert.match(html, /Salary Slip/);
    assert.match(html, /pay-grid/);
    assert.match(html, /data-slot-role="employee"/);
    assert.match(html, /data-slot-role="hr"/);
    assert.doesNotMatch(html, /data-sheet-foot="1"/);
    assert.doesNotMatch(html, /data-logo="1"/);
    assert.doesNotMatch(html, /data-management="1"/);
    assert.doesNotMatch(html, />Logo</);
  });

  it("prints the selected staff display name on the HR block", () => {
    const html = buildEsignDocumentHtml({
      language: "en",
      kind: "penalty",
      headerEn: "Notice",
      employee: sampleEmployee(),
      staffLabel: "Sara Ahmed",
    });
    assert.match(html, /Sara Ahmed/);
  });

  it("prints the branding logo on every document kind and nothing when unset", () => {
    for (const kind of ["penalty", "loan", "payslip", "general"] as const) {
      const branded = buildEsignDocumentHtml({
        language: "en",
        kind,
        logoUrl: "https://cdn.example/brand.png",
        employee: sampleEmployee(),
      });
      // Each reference masthead prints the company mark, so a branded sheet has
      // to carry it — the old "no logo anywhere" rule predates the redesign.
      assert.match(branded, /cdn\.example\/brand\.png/, kind);
      assert.doesNotMatch(branded, /data-logo="1"/, kind);
      assert.doesNotMatch(branded, /class="logo-img"/, kind);
      const unbranded = buildEsignDocumentHtml({
        language: "en",
        kind,
        employee: sampleEmployee(),
      });
      assert.doesNotMatch(unbranded, /cdn\.example\/brand\.png/, kind);
    }
  });
});
