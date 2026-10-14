import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  bilingualTitle,
  buildEsignDocumentLayout,
  isTitleEcho,
  buildPayslipSheet,
  figmaContentEndPt,
  figmaTailBand,
  fitImageInSlot,
  isBottomRightFallback,
  LOAN_GEOM,
  maskBankNumber,
  MISSING_EMPLOYEE_SLOT,
  parseSignatureSlots,
  PAYSLIP_SLOTS,
  PENALTY_GEOM,
  PENALTY_SLOTS,
  requireEmployeeSlot,
  resolveEmployeeStampSlot,
  slotsForKind,
} from "./esign-document-layout";
import { slotsForKind as functionSlotsForKind } from "../../../../functions/src/rpcs/esign-signature-slots";
import { sampleEmployee } from "./esign-document-html";

describe("esign bilingual layout", () => {
  it("prints D1 title in English and Arabic", () => {
    const layout = buildEsignDocumentLayout({
      kind: "penalty",
      headerEn: "Penalty Notice",
      headerAr: "إشعار جزاء",
      employee: sampleEmployee(),
    });
    assert.equal(bilingualTitle(layout.title), "Penalty Notice — إشعار جزاء");
    for (const row of layout.employeeRows) {
      assert.ok(row.label.en.length > 0);
      assert.ok(row.label.ar.length > 0);
    }
  });

  it("prints D2 title and keeps acknowledgement slots empty of the employee stamp", () => {
    const layout = buildEsignDocumentLayout({
      kind: "loan",
      headerEn: "Loan Request",
      headerAr: "طلب سلفة",
      employee: sampleEmployee(),
    });
    assert.equal(bilingualTitle(layout.title), "Loan Request — طلب سلفة");
    const employee = layout.slots.find((row) => row.role === "employee");
    const ack = layout.slots.filter((row) => row.role.startsWith("ack_"));
    assert.ok(employee);
    assert.equal(ack.length, 2);
    assert.ok(ack.every((row) => row.id !== employee?.id));
  });

  it("seeds the D1 penalty checkbox set", () => {
    const layout = buildEsignDocumentLayout({
      kind: "penalty",
      employee: sampleEmployee(),
    });
    const keys = layout.sections.flatMap((section) => section.checkboxes?.map((row) => row.key) ?? []);
    assert.deepEqual(keys, [
      "written_warning",
      "deduct_10",
      "deduct_25",
      "deduct_50",
      "deduct_1_day",
      "deduct_2_day",
      "deduct_3_day",
      "deduct_4_day",
      "deduct_5_day",
      "dismissal_warning",
      "others",
    ]);
  });

  it("prints only author penalty options and ticks the selected one", () => {
    const layout = buildEsignDocumentLayout({
      kind: "penalty",
      employee: sampleEmployee(),
      fields: [
        {
          key: "penalty_action",
          labelEn: "Action",
          labelAr: "",
          value: "Written warning",
          options: ["Written warning", "Others"],
        },
      ],
    });
    const checks = layout.sections.find((section) => section.checkboxes)?.checkboxes ?? [];
    assert.deepEqual(
      checks.map((row) => row.key),
      ["written_warning", "others"],
    );
    assert.equal(checks[0]?.checked, true);
    assert.equal(checks[1]?.checked, false);
  });

  it("prints penalty absence dates in the leftover tail without moving stamps", () => {
    const layout = buildEsignDocumentLayout({
      kind: "penalty",
      employee: sampleEmployee(),
      fields: [
        { key: "absence_from", labelEn: "From", labelAr: "من", value: "2026-10-01" },
        { key: "absence_to", labelEn: "To", labelAr: "إلى", value: "2026-10-03" },
      ],
    });
    const details = layout.sections.find((section) => section.key === "penalty_details");
    assert.equal(details?.rows.find((row) => row.key === "absence_from")?.value, "2026-10-01");
    assert.equal(details?.rows.find((row) => row.key === "absence_to")?.value, "2026-10-03");
    const appendix = layout.sections.find((section) => section.key === "appendix");
    assert.equal(appendix?.rows.find((row) => row.key === "absence_from")?.value, "2026-10-01");
    assert.equal(appendix?.rows.find((row) => row.key === "absence_to")?.value, "2026-10-03");
    assert.deepEqual(layout.slots, slotsForKind("penalty"));
  });

  it("hides the penalty list when penalty_visible is none", () => {
    const layout = buildEsignDocumentLayout({
      kind: "penalty",
      employee: sampleEmployee(),
      fields: [{ key: "penalty_visible", labelEn: "", labelAr: "", value: "__none__" }],
    });
    const checks = layout.sections.find((section) => section.checkboxes)?.checkboxes ?? [];
    assert.deepEqual(checks, []);
  });

  it("keeps Next and Cloud Functions slot maps identical", () => {
    for (const kind of ["penalty", "loan", "payslip", "general"] as const) {
      assert.deepEqual(functionSlotsForKind(kind), slotsForKind(kind), kind);
    }
    const penaltyEmployee = slotsForKind("penalty").find((row) => row.role === "employee");
    const loanEmployee = slotsForKind("loan").find((row) => row.role === "employee");
    assert.equal(penaltyEmployee?.id, "employee");
    assert.equal(loanEmployee?.id, "employee");
    assert.ok((penaltyEmployee?.wPt ?? 0) < 220, "employee stamp is the ruled line, not the full row");
    assert.ok((loanEmployee?.xPt ?? 0) > 40, "employee line is inset past the label column");
  });

  it("places the employee slot away from last-page bottom-right", () => {
    for (const kind of ["penalty", "loan", "payslip", "general"] as const) {
      const employee = slotsForKind(kind).find((row) => row.role === "employee");
      assert.ok(employee, kind);
      assert.equal(isBottomRightFallback(employee!), false, kind);
      assert.ok(employee!.yPt > 80, `${kind} too close to page bottom`);
      assert.ok(employee!.xPt < A4_WIDTH_PT / 2, `${kind} is on the right edge`);
    }
  });
});

describe("resolveEmployeeStampSlot", () => {
  it("recomputes from document_kind when slots are missing", () => {
    const slot = resolveEmployeeStampSlot({ kind: "penalty" });
    assert.equal(slot.role, "employee");
    assert.deepEqual(slot, PENALTY_SLOTS[0]);
  });

  it("uses a persisted employee slot when it is usable", () => {
    const persisted = [{ id: "e", role: "employee", page: 1, xPt: 60, yPt: 300, wPt: 200, hPt: 24 }];
    const slot = resolveEmployeeStampSlot({ persisted, kind: "loan" });
    assert.equal(slot.xPt, 60);
    assert.equal(slot.yPt, 300);
  });

  it("ignores invalid persisted slots and recomputes", () => {
    const slot = resolveEmployeeStampSlot({
      persisted: [{ role: "employee", page: 1, xPt: 900, yPt: 10, wPt: 10, hPt: 10 }],
      kind: "loan",
    });
    assert.equal(slot.id, "employee");
    assert.equal(isBottomRightFallback(slot), false);
  });

  it("falls back to general when the kind is unknown", () => {
    const slot = resolveEmployeeStampSlot({
      persisted: parseSignatureSlots([]),
      kind: "not-a-kind-and-empty",
    });
    assert.equal(slot.role, "employee");
    assert.deepEqual(slot, slotsForKind("general")[0]);
  });

  it("throws a named error when the resolved list has no usable employee", () => {
    assert.throws(
      () => requireEmployeeSlot([]),
      (error: unknown) => error instanceof Error && error.message === MISSING_EMPLOYEE_SLOT,
    );
  });
});

describe("payslip sheet", () => {
  it("lays out an identity grid and a Code/Name rate table", () => {
    const layout = buildEsignDocumentLayout({
      kind: "payslip",
      headerEn: "Salary Slip — August 2026",
      headerAr: "قسيمة راتب — أغسطس 2026",
      employee: sampleEmployee({
        company_name: "MGGO Logistics LLC",
        employee_name: "Employee A",
        employee_id: "E-1041",
        position: "Rider",
        sponsor: "MGGO Logistics",
        pay_through: "Bank",
        bank_number: "KW81XXXX1041",
        civil_id: "2XXXXXXXXXX41",
      }),
      fields: [
        { key: "period_from", labelEn: "Date from", labelAr: "من", value: "01/08/2026" },
        { key: "period_to", labelEn: "Date to", labelAr: "إلى", value: "31/08/2026" },
        { key: "computed_on", labelEn: "Computed on", labelAr: "الاحتساب", value: "01/09/2026" },
        { key: "fixed_working_days", labelEn: "Fixed", labelAr: "ثابت", value: "26" },
        { key: "actual_working_days", labelEn: "Actual Working Days", labelAr: "أيام العمل الفعلية", value: "26" },
        { key: "deduction_amount_kwd", labelEn: "Administration deduction", labelAr: "خصم", value: "15.000" },
        { key: "extra_input_kwd", labelEn: "Extra Input", labelAr: "إضافي", value: "0.000" },
        { key: "basic_salary_kwd", labelEn: "Basic Salary", labelAr: "أساسي", value: "260.000" },
        { key: "net_salary_kwd", labelEn: "Net Salary", labelAr: "صافي", value: "245.000" },
      ],
    });
    const sheet = layout.payslip;
    assert.ok(sheet);
    assert.equal(sheet.identity.find((row) => row.key === "company")?.value, "MGGO Logistics LLC");
    assert.equal(sheet.identity.find((row) => row.key === "employee_position")?.value, "Employee A / Rider");
    assert.match(sheet.identity.find((row) => row.key === "pay_bank")?.value ?? "", /KW81…1041/);
    assert.equal(sheet.lines[0]?.key, "actual_working_days");
    assert.equal(sheet.lines[0]?.rate, "1.00");
    assert.equal(sheet.lines[0]?.amount, "26 days");
    assert.equal(sheet.lines.find((line) => line.key === "net_salary_kwd")?.code, "NET");
    assert.equal(sheet.lines.find((line) => line.key === "deduction_amount_kwd")?.code, "Ded");
    assert.deepEqual(layout.slots, PAYSLIP_SLOTS);
    assert.equal(maskBankNumber(""), "—");
    assert.equal(maskBankNumber("KW81XXXX1041"), "KW81…1041");
    const empty = buildPayslipSheet({}, []);
    assert.equal(empty.identity.find((row) => row.key === "company")?.value, "—");
  });
});

describe("single page tail band", () => {
  it("keeps the penalty and loan tails inside one A4 page", () => {
    for (const steps of [PENALTY_GEOM, LOAN_GEOM]) {
      const end = figmaContentEndPt(steps);
      const tail = figmaTailBand(steps);
      assert.ok(end < A4_HEIGHT_PT - 24);
      assert.ok(tail.height > 40);
      assert.ok(tail.top + tail.height <= A4_HEIGHT_PT);
    }
  });
});

describe("fitImageInSlot", () => {
  it("centres a PNG inside the employee slot without overflow", () => {
    const box = PENALTY_SLOTS[0];
    const fitted = fitImageInSlot(400, 120, box);
    assert.ok(fitted.w <= box.wPt + 0.01);
    assert.ok(fitted.h <= box.hPt + 0.01);
    assert.ok(fitted.x >= box.xPt - 0.01);
    assert.ok(fitted.y >= box.yPt - 0.01);
    assert.ok(fitted.x + fitted.w <= box.xPt + box.wPt + 0.01);
    assert.ok(fitted.y + fitted.h <= box.yPt + box.hPt + 0.01);
    assert.ok(Math.abs(fitted.w / fitted.h - 400 / 120) < 0.01);
  });

  it("is not the hardcoded 36pt bottom-right stamp", () => {
    const box = resolveEmployeeStampSlot({ kind: "penalty" });
    const fitted = fitImageInSlot(180, 60, box);
    assert.ok(fitted.x < A4_WIDTH_PT - 80);
    assert.ok(fitted.y > 80);
    assert.ok(fitted.y !== 36);
  });

  it("treats a seed title echo as leftover noise", () => {
    assert.equal(
      isTitleEcho({ en: "Penalty notice", ar: "إشعار جزاء" }, { en: "Penalty Notice", ar: "إشعار جزاء" }),
      true,
    );
    assert.equal(
      isTitleEcho({ en: "Please read this notice.", ar: "" }, { en: "Penalty Notice", ar: "إشعار جزاء" }),
      false,
    );
  });
});
