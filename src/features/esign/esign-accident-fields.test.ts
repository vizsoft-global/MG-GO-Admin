import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACCIDENT_REQUEST_KINDS,
  REQUEST_KIND_KEY,
  accidentKindLabel,
  isAccidentRequest,
  normalizeAccidentKind,
  requestedDocumentLines,
  withAccidentFields,
} from "./esign-accident-fields";

describe("accident request kinds", () => {
  it("keeps the four kinds and falls back to Accident", () => {
    assert.deepEqual(
      ACCIDENT_REQUEST_KINDS.map((kind) => kind.value),
      ["accident", "sick_leave", "medical_report", "declaration"],
    );
    assert.equal(normalizeAccidentKind("sick_leave"), "sick_leave");
    assert.equal(normalizeAccidentKind("nope"), "accident");
    assert.equal(normalizeAccidentKind(null), "accident");
    assert.deepEqual(accidentKindLabel("medical_report"), {
      en: "Medical report",
      ar: "تقرير طبي",
    });
  });

  it("splits requested documents on lines and commas", () => {
    assert.deepEqual(
      requestedDocumentLines("Sick leave form\nMedical report, sick leave form"),
      ["Sick leave form", "Medical report"],
    );
    assert.deepEqual(requestedDocumentLines(null), []);
  });

  it("adds From/To for sick leave and the accident pair otherwise", () => {
    const sick = withAccidentFields([], "template-1", "sick_leave");
    assert.deepEqual(
      sick.map((field) => field.field_key),
      ["absence_from", "absence_to"],
    );
    assert.equal(sick[0]?.field_type, "date");

    const accident = withAccidentFields([], "template-1", "accident");
    assert.deepEqual(
      accident.map((field) => field.field_key),
      ["accident_date", "report_date"],
    );
  });

  it("does not duplicate a date pair the template already carries", () => {
    const fields = withAccidentFields(
      [
        {
          id: "f1",
          template_id: "template-1",
          field_key: "accident_date",
          label_en: "Accident date",
          label_ar: "تاريخ الحادث",
          field_type: "date",
          options: [],
          is_required: false,
          sort_order: 5,
          source_kind: "entry",
          section_key: "document",
          options_source: null,
          preview_value: null,
        },
      ],
      "template-1",
      "accident",
    );
    assert.equal(fields.filter((field) => field.field_key === "accident_date").length, 1);
    assert.equal(fields.some((field) => field.field_key === "report_date"), true);
  });

  it("detects the kind from values or the template fields", () => {
    assert.equal(isAccidentRequest({ [REQUEST_KIND_KEY]: "accident" }, []), true);
    assert.equal(
      isAccidentRequest({}, [{ field_key: REQUEST_KIND_KEY }]),
      true,
    );
    assert.equal(isAccidentRequest({}, []), false);
  });
});
