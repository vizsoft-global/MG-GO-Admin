import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { previewFieldValues } from "./esign-sheet-fields";
import type { EsignTemplateFieldRow } from "./types";
import type { EsignEmployeeSnapshot } from "./render/esign-placeholders";

function field(key: string, preview: string): EsignTemplateFieldRow {
  return {
    id: key,
    template_id: "t",
    field_key: key,
    label_en: key,
    label_ar: null,
    field_type: "text",
    options: [],
    is_required: false,
    sort_order: 0,
    source_kind: "system",
    section_key: "employee",
    options_source: null,
    preview_value: preview,
  };
}

const sample: EsignEmployeeSnapshot = {
  company_name: "MG",
  employee_name: "Sara",
  employee_id: "1088",
  driver_code: "10001",
  civil_id: null,
  joined_at: null,
  accommodation: null,
  zone: null,
  project: null,
  nationality: null,
  pay_through: "",
  bank_number: "",
};

describe("previewFieldValues", () => {
  const fields = [
    field("pay_through", "Salary"),
    field("bank_number", "1234567890"),
    field("date_from", "01-10-2026"),
    field("period_from", "01-10-2026"),
  ];

  it("uses template samples before a rider is chosen", () => {
    const preview = previewFieldValues(fields, {}, null);
    assert.equal(preview.pay_through, "Salary");
    assert.equal(preview.bank_number, "1234567890");
    assert.equal(preview.date_from, "01-10-2026");
  });

  it("drops sample bank, pay-through and dates once a rider snapshot exists", () => {
    const preview = previewFieldValues(fields, {}, sample);
    assert.equal(preview.pay_through, "");
    assert.equal(preview.bank_number, "");
    assert.equal(preview.date_from, undefined);
    assert.equal(preview.period_from, undefined);
    assert.equal(preview.employee_name, "Sara");
  });
});
