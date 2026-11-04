import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canTransitionStage,
  effectiveRecordCost,
  isDoneRecord,
  isFutureDay,
  isTerminalStage,
  nextStageOptions,
  normaliseParts,
  odometerDecision,
  odometerOf,
  openCount,
  partTotal,
  partsTotal,
  recordDay,
  recordStage,
  stageCounts,
  transitionRequiresNote,
  validateServiceRecordInput,
  type ServiceRecordInput,
} from "./service-records-model";

const TODAY = "2026-03-01";

function input(overrides: Partial<ServiceRecordInput> = {}): ServiceRecordInput {
  return {
    vehicleId: "v1",
    servicedAt: "2026-02-20",
    description: "Oil change",
    serviceTypeKey: "oil_filter",
    driverId: "",
    invoiceNo: "",
    invoiceDate: "",
    company: "",
    vendor: "",
    notes: "",
    odometerKm: 80000,
    costKwd: 25,
    parts: [],
    ...overrides,
  };
}

describe("service record stage workflow", () => {
  it("allows New → Running → Done and any open record → Cancelled", () => {
    assert.equal(canTransitionStage("new", "running"), true);
    assert.equal(canTransitionStage("new", "done"), true);
    assert.equal(canTransitionStage("new", "cancelled"), true);
    assert.equal(canTransitionStage("running", "done"), true);
    assert.equal(canTransitionStage("running", "cancelled"), true);
    assert.deepEqual(nextStageOptions("new"), ["running", "done", "cancelled"]);
    assert.deepEqual(nextStageOptions("running"), ["done", "cancelled"]);
  });

  it("keeps Done and Cancelled terminal, and refuses a no-op", () => {
    assert.equal(isTerminalStage("done"), true);
    assert.equal(isTerminalStage("cancelled"), true);
    assert.equal(canTransitionStage("done", "running"), false);
    assert.equal(canTransitionStage("cancelled", "new"), false);
    assert.equal(canTransitionStage("new", "new"), false);
    assert.deepEqual(nextStageOptions("done"), []);
  });

  it("requires a reason to cancel", () => {
    assert.equal(transitionRequiresNote("cancelled"), true);
    assert.equal(transitionRequiresNote("running"), false);
    assert.equal(transitionRequiresNote("done"), false);
  });

  it("reads a legacy row with no stage as Done", () => {
    assert.equal(recordStage({}), "done");
    assert.equal(recordStage({ stage: "running" }), "running");
    assert.equal(isDoneRecord({}), true);
    assert.equal(isDoneRecord({ stage: "new" }), false);
    assert.equal(isDoneRecord({ stage: "running" }), false);
    assert.equal(isDoneRecord({ stage: "cancelled" }), false);
  });

  it("counts the stage tabs", () => {
    const counts = stageCounts([
      { stage: "new" },
      { stage: "running" },
      { stage: "done" },
      { stage: "cancelled" },
      { stage: "done" },
    ]);
    assert.equal(counts.all, 5);
    assert.equal(counts.done, 2);
    assert.equal(openCount(counts), 2);
  });
});

describe("service record validation", () => {
  it("refuses a future service date and a future invoice date", () => {
    assert.equal(isFutureDay("2026-03-02", TODAY), true);
    assert.equal(isFutureDay("2026-03-01", TODAY), false);
    const future = validateServiceRecordInput(input({ servicedAt: "2026-12-01" }), TODAY);
    assert.deepEqual(future, { ok: false, error: "future_date" });
    const invoice = validateServiceRecordInput(input({ invoiceDate: "2026-12-01" }), TODAY);
    assert.deepEqual(invoice, { ok: false, error: "future_date" });
  });

  it("needs a vehicle, a date and a service type or a description", () => {
    assert.deepEqual(validateServiceRecordInput(input({ vehicleId: "" }), TODAY), {
      ok: false,
      error: "missing_vehicle",
    });
    assert.deepEqual(validateServiceRecordInput(input({ servicedAt: "20-02-2026" }), TODAY), {
      ok: false,
      error: "invalid_date",
    });
    assert.deepEqual(
      validateServiceRecordInput(input({ serviceTypeKey: "", description: "" }), TODAY),
      { ok: false, error: "missing_service_type" },
    );
    // A free-text description alone is enough; the catalog is not mandatory.
    assert.deepEqual(
      validateServiceRecordInput(input({ serviceTypeKey: "", description: "Roadside fix" }), TODAY),
      { ok: true },
    );
  });

  it("refuses negative money and a broken part line", () => {
    assert.deepEqual(validateServiceRecordInput(input({ costKwd: -1 }), TODAY), {
      ok: false,
      error: "invalid_cost",
    });
    assert.deepEqual(
      validateServiceRecordInput(
        input({ parts: [{ name: "Pad", qty: 0, unit_cost_kwd: 5, total_kwd: 0 }] }),
        TODAY,
      ),
      { ok: false, error: "invalid_part" },
    );
  });
});

describe("service record parts arithmetic", () => {
  it("multiplies quantity by unit cost", () => {
    assert.equal(partTotal(2, 3.5), 7);
    assert.equal(partTotal("", 3), 0);
    assert.equal(partTotal(3, ""), 0);
  });

  it("drops blank lines and totals the rest", () => {
    const parts = normaliseParts([
      { name: "Oil filter", qty: 2, unit_cost_kwd: 3 },
      { name: "", qty: 4, unit_cost_kwd: 1 },
      { name: "Spark plug", qty: 0, unit_cost_kwd: 2 },
      { name: "Wiper blade", qty: 2, unit_cost_kwd: 2.25 },
    ]);
    assert.equal(parts.length, 2);
    assert.equal(parts[0]?.total_kwd, 6);
    assert.equal(partsTotal(parts), 10.5);
  });

  it("does not add the parts to an invoice figure, but uses them when there is none", () => {
    const parts = normaliseParts([{ name: "Pad", qty: 2, unit_cost_kwd: 10 }]);
    assert.equal(effectiveRecordCost({ cost_kwd: 45, parts }), 45);
    assert.equal(effectiveRecordCost({ cost_kwd: null, parts }), 20);
    assert.equal(effectiveRecordCost({ cost_kwd: null, parts: [] }), 0);
  });
});

describe("odometer guard", () => {
  it("advances the stored figure", () => {
    assert.deepEqual(odometerDecision(70000, 80000), { action: "set", km: 80000 });
    assert.deepEqual(odometerDecision(80000, 80000), { action: "same", km: 80000 });
    assert.deepEqual(odometerDecision(null, 5000), { action: "set", km: 5000 });
    assert.deepEqual(odometerDecision(70000, null), { action: "skip" });
    assert.deepEqual(odometerDecision(70000, -5), { action: "invalid" });
  });

  it("refuses a reading below the current one", () => {
    assert.deepEqual(odometerDecision(185000, 78500), {
      action: "refuse_below",
      km: 78500,
      currentKm: 185000,
    });
    // The refusal is what the dashcam sync and the baseline import rely on: those
    // paths are unattended, so a lower machine reading is never written.
    assert.equal(odometerDecision(185000, 78500, { allowBelow: false }).action, "refuse_below");
  });

  it("reports a downward correction for a person, who must give a reason", () => {
    // A typo or a replaced meter does need the figure to come down. The decision
    // only reports it; the reason gate lives in the action.
    assert.deepEqual(odometerDecision(185000, 78500, { allowBelow: true }), {
      action: "lower",
      km: 78500,
      currentKm: 185000,
    });
    // An upward reading under `allowBelow` is an ordinary set.
    assert.deepEqual(odometerDecision(70000, 80000, { allowBelow: true }), {
      action: "set",
      km: 80000,
    });
  });

  it("treats a blank stored odometer as unknown, never as zero", () => {
    assert.equal(odometerOf({ odometer_km: null, odometer: null }), null);
    assert.equal(odometerOf({ odometer_km: 90000, odometer: 12000 }), 90000);
    // A legacy row only has `odometer`.
    assert.equal(odometerOf({ odometer_km: null, odometer: 4321 }), 4321);
  });

  it("dates the record by done_at when it is Done", () => {
    assert.equal(
      recordDay({ done_at: "2026-02-25T10:00:00.000Z", serviced_at: "2026-02-20" }),
      "2026-02-25",
    );
    assert.equal(
      recordDay({ done_at: null, serviced_at: "2026-02-20T00:00:00.000Z" }),
      "2026-02-20",
    );
  });
});

