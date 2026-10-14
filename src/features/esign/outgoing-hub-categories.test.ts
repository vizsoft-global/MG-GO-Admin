import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alignPenaltyCategoryKey,
  effectiveOutgoingCategoryKey,
  isOutgoingHubCategory,
  isPenaltyHubQuery,
  isSendableHubTemplate,
  outgoingHubDraftDecision,
  OUTGOING_HUB_CATEGORY_KEYS,
  pickSendableHubTemplate,
  selectOptionsForField,
  templatesForHubCategory,
} from "./outgoing-hub-categories";

describe("outgoing hub categories", () => {
  it("lists the eight HUB parents", () => {
    assert.deepEqual([...OUTGOING_HUB_CATEGORY_KEYS], [
      "loan",
      "payslip",
      "asset",
      "leave",
      "penalty",
      "investigation",
      "accident",
      "general_doc",
    ]);
  });

  it("aligns hub other to penalty_others", () => {
    assert.equal(alignPenaltyCategoryKey("other"), "penalty_others");
    assert.equal(alignPenaltyCategoryKey("late_attendance"), "late_attendance");
  });

  it("treats penalty children as hub categories", () => {
    assert.equal(isOutgoingHubCategory("penalty_others"), true);
    assert.equal(isOutgoingHubCategory("late_attendance"), true);
    assert.equal(isOutgoingHubCategory("complaint"), false);
  });

  it("lists parent plus children for a penalty query", () => {
    const rows = [
      { id: "1", category_key: "penalty" },
      { id: "2", category_key: "late_attendance" },
      { id: "3", category_key: "loan" },
    ];
    assert.deepEqual(
      templatesForHubCategory(rows, "penalty").map((row) => row.id),
      ["1", "2"],
    );
    assert.deepEqual(
      templatesForHubCategory(rows, "other").map((row) => row.id),
      ["1", "2"],
    );
    assert.deepEqual(
      templatesForHubCategory(rows, "loan").map((row) => row.id),
      ["3"],
    );
  });

  it("sendable rows are hub + active + not draft", () => {
    assert.equal(
      isSendableHubTemplate({ category_key: "loan", is_active: true, is_draft: false }),
      true,
    );
    assert.equal(
      isSendableHubTemplate({ category_key: "complaint", is_active: true, is_draft: false }),
      false,
    );
    assert.equal(
      isSendableHubTemplate({ category_key: "loan", is_active: true, is_draft: true }),
      false,
    );
    assert.equal(isPenaltyHubQuery("penalty_others"), true);
  });

  it("lets a Figma key win over a leftover V1 category", () => {
    assert.equal(
      effectiveOutgoingCategoryKey({
        category_key: "loan_agreement",
        figma_key: "loan_request",
      }),
      "loan",
    );
    assert.equal(
      effectiveOutgoingCategoryKey({
        category_key: "salary_slips",
        figma_key: "payslip",
      }),
      "payslip",
    );
    assert.equal(
      effectiveOutgoingCategoryKey({
        category_key: "other",
        figma_key: "general_document",
      }),
      "general_doc",
    );
    assert.equal(
      effectiveOutgoingCategoryKey({ category_key: "other" }),
      "penalty_others",
    );
  });

  it("lists a remapped Figma row on its hub tile, not under penalty", () => {
    const rows = [
      { id: "loan", category_key: "loan_agreement", figma_key: "loan_request" },
      { id: "pay", category_key: "salary_slips", figma_key: "payslip" },
      { id: "gen", category_key: "other", figma_key: "general_document" },
      { id: "pen", category_key: "penalty" },
    ];
    assert.deepEqual(
      templatesForHubCategory(rows, "loan").map((row) => row.id),
      ["loan"],
    );
    assert.deepEqual(
      templatesForHubCategory(rows, "payslip").map((row) => row.id),
      ["pay"],
    );
    assert.deepEqual(
      templatesForHubCategory(rows, "general_doc").map((row) => row.id),
      ["gen"],
    );
    assert.deepEqual(
      templatesForHubCategory(rows, "penalty").map((row) => row.id),
      ["pen"],
    );
  });

  it("treats an active Figma row as sendable even when the stored key is V1", () => {
    assert.equal(
      isSendableHubTemplate({
        category_key: "loan_agreement",
        figma_key: "loan_request",
        is_active: true,
        is_draft: false,
      }),
      true,
    );
    assert.equal(
      isSendableHubTemplate({
        category_key: "other",
        figma_key: "general_document",
        is_active: true,
        is_draft: false,
      }),
      true,
    );
    assert.equal(
      isSendableHubTemplate({
        category_key: "loan_agreement",
        figma_key: "loan_request",
        is_active: false,
        is_draft: true,
      }),
      false,
    );
  });

  it("promotes the Figma eight and drafts leftover V1 rows", () => {
    assert.deepEqual(
      outgoingHubDraftDecision({
        category_key: "loan_agreement",
        figma_key: "loan_request",
        is_active: false,
        is_draft: true,
      }),
      { action: "promote", category_key: "loan" },
    );
    assert.deepEqual(
      outgoingHubDraftDecision({
        category_key: "other",
        figma_key: "general_document",
        is_active: true,
        is_draft: false,
      }),
      { action: "promote", category_key: "general_doc" },
    );
    assert.deepEqual(
      outgoingHubDraftDecision({
        category_key: "loan",
        figma_key: "loan_request",
        is_active: true,
        is_draft: false,
      }),
      { action: "skip" },
    );
    assert.deepEqual(
      outgoingHubDraftDecision({
        category_key: "loan_agreement",
        name_en: "Loan Agreement and Repayment Terms",
        is_active: true,
        is_draft: false,
      }),
      { action: "draft" },
    );
    assert.deepEqual(
      outgoingHubDraftDecision({
        category_key: "accommodation",
        is_active: false,
        is_draft: true,
      }),
      { action: "skip" },
    );
  });

  it("picks the exact category template before the hub pool", () => {
    const rows = [
      { id: "parent", category_key: "penalty", is_active: true, is_draft: false },
      { id: "late", category_key: "late_attendance", is_active: true, is_draft: false },
      { id: "loan", category_key: "loan", is_active: true, is_draft: false },
    ];
    assert.equal(pickSendableHubTemplate(rows, "late_attendance")?.id, "late");
    assert.equal(pickSendableHubTemplate(rows, "penalty")?.id, "parent");
    assert.equal(pickSendableHubTemplate(rows, "written_warning"), null);
    assert.equal(pickSendableHubTemplate(rows, "loan")?.id, "loan");
  });

  it("falls back to penalty children when a select has no options", () => {
    assert.deepEqual(selectOptionsForField({ field_type: "select", options: [] }, "penalty"), [
      "late_attendance",
      "unauthorised_absence",
      "written_warning",
      "damage_to_property",
      "penalty_others",
    ]);
    assert.deepEqual(
      selectOptionsForField({ field_type: "select", options: ["a", "b"] }, "penalty"),
      ["a", "b"],
    );
    assert.deepEqual(selectOptionsForField({ field_type: "select" }, "loan"), []);
    assert.deepEqual(
      selectOptionsForField({ field_type: "text", field_key: "penalty_action", options: [] }, "penalty"),
      [
        "Written warning",
        "10% deduction of a day's salary",
        "25% deduction of a day's salary",
        "50% deduction of a day's salary",
        "One day deduction",
        "Two days deduction",
        "Three days deduction",
        "Four days deduction",
        "Five days deduction",
        "Dismissal final warning",
        "Others",
      ],
    );
  });
});
