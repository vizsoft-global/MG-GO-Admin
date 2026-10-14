import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checksFromPenaltyFields,
  defaultPenaltyActionOptions,
  isPenaltyActionFieldKey,
  parsePenaltyVisible,
  penaltyControlFieldValues,
  PENALTY_CHECKS,
  PENALTY_VISIBLE_NONE,
  resolvePenaltyCheckCatalogue,
  serializePenaltyVisible,
  slugPenaltyCheck,
} from "./esign-penalty-checks";

describe("esign penalty checks", () => {
  it("defaults an empty penalty_action field to the Figma eleven", () => {
    assert.deepEqual(
      defaultPenaltyActionOptions({ field_key: "penalty_action", options: [] }),
      PENALTY_CHECKS.map((check) => check.label.en),
    );
    assert.deepEqual(defaultPenaltyActionOptions({ field_key: "notes", options: [] }), []);
    assert.equal(isPenaltyActionFieldKey("penalty_action"), true);
    assert.equal(isPenaltyActionFieldKey("penalty"), false);
  });

  it("prints only the author options and ticks the matching row", () => {
    const fields = [
      {
        key: "penalty_action",
        labelEn: "Penalty",
        labelAr: "",
        value: "Written warning",
        options: ["Written warning", "Others"],
      },
    ];
    const checks = checksFromPenaltyFields(fields);
    assert.deepEqual(
      checks.map((row) => row.key),
      ["written_warning", "others"],
    );
    assert.equal(checks[0]?.checked, true);
    assert.equal(checks[1]?.checked, false);
  });

  it("hides every option when penalty_visible is none", () => {
    assert.deepEqual(parsePenaltyVisible(PENALTY_VISIBLE_NONE), []);
    assert.equal(serializePenaltyVisible([]), PENALTY_VISIBLE_NONE);
    assert.equal(parsePenaltyVisible(""), null);
    const checks = checksFromPenaltyFields([
      {
        key: "penalty_visible",
        labelEn: "",
        labelAr: "",
        value: PENALTY_VISIBLE_NONE,
      },
    ]);
    assert.deepEqual(checks, []);
  });

  it("keeps a custom option and slugs it", () => {
    assert.equal(slugPenaltyCheck("Written warning"), "written_warning");
    const catalogue = resolvePenaltyCheckCatalogue({
      fields: [{ key: "penalty_action", options: ["Six day deduction"] }],
    });
    assert.deepEqual(
      catalogue.map((row) => row.key),
      ["six_day_deduction"],
    );
  });

  it("writes visible keys and the selected action", () => {
    const catalogue = resolvePenaltyCheckCatalogue({
      fields: [{ key: "penalty_action", options: ["Written warning", "Others"] }],
    });
    const values = penaltyControlFieldValues(catalogue, ["written_warning"], ["others"]);
    assert.equal(values.penalty_action, "Written warning");
    assert.equal(values.written_warning, "checked");
    assert.equal(values.others, "");
    assert.equal(values.penalty_visible, "written_warning");
  });

  it("ticks every selected penalty action", () => {
    const fields = [
      {
        key: "penalty_action",
        labelEn: "Penalty",
        labelAr: "",
        value: "Written warning, One day deduction",
        options: ["Written warning", "One day deduction", "Others"],
      },
    ];
    const checks = checksFromPenaltyFields(fields);
    assert.deepEqual(
      checks.filter((row) => row.checked).map((row) => row.key),
      ["written_warning", "deduct_1_day"],
    );
    const catalogue = resolvePenaltyCheckCatalogue({ fields });
    const values = penaltyControlFieldValues(
      catalogue,
      ["written_warning", "deduct_1_day"],
      [],
    );
    assert.equal(values.penalty_action, "Written warning, One day deduction");
    assert.equal(values.written_warning, "checked");
    assert.equal(values.deduct_1_day, "checked");
    assert.equal(values.others, "");
  });

  it("drops hidden keys from the printed list", () => {
    const catalogue = resolvePenaltyCheckCatalogue({
      hiddenKeys: ["others", "written_warning"],
    });
    assert.equal(catalogue.some((row) => row.key === "others"), false);
    assert.equal(catalogue.some((row) => row.key === "written_warning"), false);
    assert.equal(catalogue.length, PENALTY_CHECKS.length - 2);
  });
});
