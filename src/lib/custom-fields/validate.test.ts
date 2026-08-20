import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coerceCustomFieldValue,
  formatCustomFieldDisplay,
  optionValueFromLabel,
  parseOptions,
  validateCustomFieldValues,
} from "./validate";

const LANG_OPTS = [
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
];

describe("custom field number non-negative", () => {
  it("accepts zero and positive numbers", () => {
    assert.deepEqual(coerceCustomFieldValue("number", 0, []), { value: 0 });
    assert.deepEqual(coerceCustomFieldValue("number", 9, []), { value: 9 });
    assert.deepEqual(coerceCustomFieldValue("number", "12.5", []), {
      value: 12.5,
    });
  });

  it("rejects negatives", () => {
    assert.deepEqual(coerceCustomFieldValue("number", -9, []), {
      value: null,
      error: "negative_number",
    });
    assert.deepEqual(coerceCustomFieldValue("number", "-1", []), {
      value: null,
      error: "negative_number",
    });
  });

  it("surfaces negative_number on validateCustomFieldValues", () => {
    const result = validateCustomFieldValues(
      [
        {
          key: "age",
          field_type: "number",
          required: false,
          options: [],
          is_active: true,
          archived_at: null,
        },
      ],
      { age: -9 },
    );
    assert.equal(result.errors.some((e) => e.code === "negative_number"), true);
  });
});

describe("parseOptions", () => {
  it("keeps a label-only checkbox choice instead of dropping it", () => {
    assert.deepEqual(parseOptions([{ label: "Helmet" }]), [
      { value: "helmet", label: "Helmet" },
    ]);
  });

  it("keeps a value-only choice and uses it as the display text", () => {
    assert.deepEqual(parseOptions([{ value: "jacket" }]), [
      { value: "jacket", label: "jacket" },
    ]);
  });

  it("does not copy value into a blank label when both were typed", () => {
    assert.deepEqual(parseOptions([{ value: "h1", label: "Helmet" }]), [
      { value: "h1", label: "Helmet" },
    ]);
  });

  it("keeps unicode letters in the stored value", () => {
    assert.equal(optionValueFromLabel("خوذة"), "خوذة");
    assert.deepEqual(parseOptions([{ label: "خوذة" }]), [
      { value: "خوذة", label: "خوذة" },
    ]);
  });
});

describe("custom field multi-checkbox", () => {
  it("keeps legacy boolean when options are empty", () => {
    assert.deepEqual(coerceCustomFieldValue("checkbox", true, []), {
      value: true,
    });
    assert.deepEqual(coerceCustomFieldValue("checkbox", "false", []), {
      value: false,
    });
  });

  it("coerces arrays and comma / JSON strings", () => {
    assert.deepEqual(
      coerceCustomFieldValue("checkbox", ["en", "ar"], LANG_OPTS),
      { value: ["en", "ar"] },
    );
    assert.deepEqual(
      coerceCustomFieldValue("checkbox", "en,hi", LANG_OPTS),
      { value: ["en", "hi"] },
    );
    assert.deepEqual(
      coerceCustomFieldValue("checkbox", '["en","Arabic"]', LANG_OPTS),
      { value: ["en", "ar"] },
    );
  });

  it("requires at least one selection when required", () => {
    const result = validateCustomFieldValues(
      [
        {
          key: "langs",
          field_type: "checkbox",
          required: true,
          options: LANG_OPTS,
          is_active: true,
          archived_at: null,
        },
      ],
      { langs: [] },
    );
    assert.equal(result.errors.some((e) => e.code === "required"), true);
  });

  it("formats multi labels", () => {
    assert.equal(
      formatCustomFieldDisplay("checkbox", ["en", "hi"], LANG_OPTS),
      "English, Hindi",
    );
    assert.equal(formatCustomFieldDisplay("checkbox", true, []), "Yes");
  });
});
