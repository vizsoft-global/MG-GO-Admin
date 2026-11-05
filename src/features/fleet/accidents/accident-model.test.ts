import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accidentAttachmentCount,
  accidentAttachmentKeys,
  accidentCaseStatusOf,
  accidentDayOf,
  accidentDescriptionOf,
  accidentMatchesSearch,
  accidentWritePayload,
  computeAccidentKpis,
  editableAccidentFields,
  filterAccidents,
  groupAccidentsByCase,
  isRiderReportAwaitingCompletion,
  legacySeverityLabel,
  parseAccidentRow,
  phoneDigits,
  sortAccidents,
  validateAccidentInput,
} from "./accident-model";
import {
  ACCIDENT_CASE_STATUS_LABELS,
  DRIVER_FAULT_LABELS,
  INSURANCE_CLAIM_STATUS_LABELS,
  POLICE_REPORT_STATUS_LABELS,
  VEHICLE_CASE_STATUS_LABELS,
  type AccidentInput,
} from "./accident-types";

const NOW = new Date("2026-11-02T10:00:00.000Z");

function input(overrides: Partial<AccidentInput> = {}): AccidentInput {
  return {
    vehicleId: "veh-1",
    occurredAt: "2026-11-01T18:30",
    locationText: "Ring Road, near KFC ALREQA",
    locationLat: 29.3,
    locationLng: 47.9,
    driverFault: "yes",
    caseStatus: "pending",
    vehicleCaseStatus: "case_check",
    insuranceCompany: "Gulf Insurance",
    insuranceClaimStatus: "submitted",
    policeReportStatus: "filed",
    amountKwd: 120.5,
    otherPartyName: "Ahmed",
    otherPartyPlate: "12345",
    otherPartyPhone: "+965 9000 1234",
    description: "Rear bumper hit at the lights.",
    fleetComment: "",
    replacementPlate: "",
    severity: "",
    notes: "",
    attachmentKeys: ["vehicles/veh-1/accidents/a.jpg"],
    ...overrides,
  };
}

const SNAPSHOT = {
  plate: "8421",
  company_name: "Americana",
  model_year: 2023,
  driver_id: "drv-1",
  driver_name: "Sam Test",
  driver_code: "D-1",
  employee_id: "10043",
};

const WRITE_OPTIONS = {
  reference: "ACC-0001",
  attachments: [],
  source: "admin" as const,
  reportedBy: "staff-1",
  reportedByName: "Operator",
  caseStatus: "pending" as const,
  vehicleCaseStatus: "case_check",
  now: NOW,
};

describe("accident vocabulary", () => {
  it("prints exactly Close / Pending / Delay", () => {
    assert.equal(ACCIDENT_CASE_STATUS_LABELS.close.en, "Close");
    assert.equal(ACCIDENT_CASE_STATUS_LABELS.pending.en, "Pending");
    assert.equal(ACCIDENT_CASE_STATUS_LABELS.delay.en, "Delay");
    // No "Closed", no "Delayed" — the client's PDF prints the singular words.
    assert.equal(ACCIDENT_CASE_STATUS_LABELS.close.en.endsWith("d"), false);
    assert.equal(ACCIDENT_CASE_STATUS_LABELS.delay.en.endsWith("d"), false);
  });

  it("has every Arabic label filled in", () => {
    for (const group of [
      ACCIDENT_CASE_STATUS_LABELS,
      DRIVER_FAULT_LABELS,
      VEHICLE_CASE_STATUS_LABELS,
      INSURANCE_CLAIM_STATUS_LABELS,
      POLICE_REPORT_STATUS_LABELS,
    ]) {
      for (const value of Object.values(group)) {
        assert.ok(value.en.length > 0);
        assert.ok(value.ar.length > 0);
      }
    }
  });

  it("offers Yes / No and nothing else for driver fault", () => {
    assert.deepEqual(Object.keys(DRIVER_FAULT_LABELS).sort(), ["no", "yes"]);
  });
});

describe("parseAccidentRow", () => {
  it("maps a legacy row without rewriting it", () => {
    const row = parseAccidentRow("legacy-1", {
      vehicle_id: "veh-1",
      occurred_at: "2026-09-01T10:00:00.000Z",
      severity: "medium",
      notes: "cracked mirror",
      storage_key: "vehicles/veh-1/accidents/legacy.jpg",
    });
    assert.equal(row.reference, null);
    assert.equal(row.case_status, null);
    // Display-only default, the stored document keeps no case_status.
    assert.equal(accidentCaseStatusOf(row), "pending");
    assert.equal(row.source, "admin");
    assert.equal(accidentDescriptionOf(row), "cracked mirror");
    assert.deepEqual(accidentAttachmentKeys(row), ["vehicles/veh-1/accidents/legacy.jpg"]);
    assert.equal(accidentAttachmentCount(row), 1);
    assert.equal(legacySeverityLabel(row.severity), "Medium");
  });

  it("folds the legacy storage_key beside the new keys without duplicating it", () => {
    const row = parseAccidentRow("a1", {
      vehicle_id: "veh-1",
      attachment_keys: ["k1", "k2"],
      storage_key: "k2",
    });
    assert.deepEqual(accidentAttachmentKeys(row), ["k1", "k2"]);
    assert.equal(accidentAttachmentCount(row), 2);
  });

  it("keeps its own severity label and never invents one", () => {
    assert.equal(legacySeverityLabel("low"), "Low");
    assert.equal(legacySeverityLabel("high"), "High");
    assert.equal(legacySeverityLabel(null), "—");
    assert.equal(legacySeverityLabel("critical"), "—");
  });
});

describe("validateAccidentInput", () => {
  it("refuses a future date and accepts a historical one", () => {
    const future = validateAccidentInput(input({ occurredAt: "2026-12-01T09:00" }), NOW);
    assert.equal(future.ok, false);
    if (!future.ok) assert.equal(future.error, "future_date");

    const old = validateAccidentInput(input({ occurredAt: "2025-01-05T09:00" }), NOW);
    assert.equal(old.ok, true);
  });

  it("accepts an accident from any past distance — there is no seven-day window", () => {
    const thirtyDays = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    const value = validateAccidentInput(input({ occurredAt: thirtyDays.toISOString() }), NOW);
    assert.equal(value.ok, true);
  });

  it("restricts driver fault to Yes / No", () => {
    const bad = validateAccidentInput(input({ driverFault: "under_investigation" }), NOW);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error, "invalid_driver_fault");
    assert.equal(validateAccidentInput(input({ driverFault: "no" }), NOW).ok, true);
    assert.equal(validateAccidentInput(input({ driverFault: "" }), NOW).ok, true);
  });

  it("restricts the case to the three keys", () => {
    const bad = validateAccidentInput(input({ caseStatus: "closed" }), NOW);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error, "invalid_case_status");
  });

  it("refuses a negative amount, a short phone, a missing location and too many files", () => {
    const amount = validateAccidentInput(input({ amountKwd: -1 }), NOW);
    const phone = validateAccidentInput(input({ otherPartyPhone: "12345" }), NOW);
    const location = validateAccidentInput(input({ locationText: "  " }), NOW);
    const files = validateAccidentInput(
      input({ attachmentKeys: Array.from({ length: 11 }, (_, i) => `k${i}`) }),
      NOW,
    );
    assert.equal(amount.ok, false);
    assert.equal(phone.ok, false);
    assert.equal(location.ok, false);
    assert.equal(files.ok, false);
    if (!phone.ok) assert.equal(phone.error, "invalid_phone");
    if (!location.ok) assert.equal(location.error, "location_required");
    if (!files.ok) assert.equal(files.error, "too_many_attachments");
  });

  it("requires a replacement plate for a replaced vehicle", () => {
    const missing = validateAccidentInput(
      input({ vehicleCaseStatus: "total_loss_replaced", replacementPlate: "" }),
      NOW,
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error, "replacement_plate_required");
    const given = validateAccidentInput(
      input({ vehicleCaseStatus: "total_loss_replaced", replacementPlate: "9911" }),
      NOW,
    );
    assert.equal(given.ok, true);
  });

  it("counts phone digits regardless of spaces and a leading plus", () => {
    assert.equal(phoneDigits("+965 9000-1234"), "96590001234");
  });
});


function row(id: string, overrides: Record<string, unknown> = {}) {
  return parseAccidentRow(id, {
    vehicle_id: "veh-1",
    occurred_at: "2026-10-01T10:00:00.000Z",
    case_status: "pending",
    ...overrides,
  });
}

describe("accident counting, filtering and grouping", () => {
  const rows = [
    row("a", { case_status: "pending" }),
    row("b", { case_status: "delay" }),
    row("c", { case_status: "close" }),
    row("d", { source: "rider", case_status: "pending", driver_id: "drv-1" }),
    row("e", { source: "rider", case_status: "close", reviewed_at: "2026-10-02T10:00:00.000Z" }),
  ];

  it("counts open as Pending + Delay and reports rider reports awaiting completion", () => {
    const kpis = computeAccidentKpis(rows);
    assert.equal(kpis.total, 5);
    assert.equal(kpis.pending, 2);
    assert.equal(kpis.delay, 1);
    assert.equal(kpis.close, 2);
    assert.equal(kpis.open, 3);
    assert.equal(kpis.riderAwaiting, 1);
  });

  it("treats a reviewed rider report as complete", () => {
    assert.equal(isRiderReportAwaitingCompletion(rows[3]!), true);
    assert.equal(isRiderReportAwaitingCompletion(rows[4]!), false);
  });

  it("filters by case, source, driver and dates", () => {
    const empty = {
      caseStatus: "",
      source: "",
      vehicleId: "",
      driverId: "",
      from: "",
      to: "",
      insuranceClaimStatus: "",
      policeReportStatus: "",
    };
    assert.equal(filterAccidents(rows, { ...empty, caseStatus: "close" }).length, 2);
    assert.equal(filterAccidents(rows, { ...empty, source: "rider" }).length, 2);
    assert.equal(filterAccidents(rows, { ...empty, driverId: "drv-1" }).length, 1);
    assert.equal(filterAccidents(rows, { ...empty, from: "2026-10-01", to: "2026-10-01" }).length, 5);
    assert.equal(filterAccidents(rows, { ...empty, from: "2026-10-02" }).length, 0);
  });

  it("groups by case in the PDF's order", () => {
    const groups = groupAccidentsByCase(rows);
    assert.deepEqual(
      groups.map((group) => group.status),
      ["pending", "delay", "close"],
    );
    assert.equal(groups[0]!.rows.length, 2);
  });

  it("searches the reference, plate, driver and description", () => {
    const target = row("x", {
      reference: "ACC-0042",
      plate_snapshot: "8421",
      driver_name: "Sam Test",
      description: "rear bumper",
    });
    assert.equal(accidentMatchesSearch(target, "acc-0042"), true);
    assert.equal(accidentMatchesSearch(target, "sam"), true);
    assert.equal(accidentMatchesSearch(target, "bumper"), true);
    assert.equal(accidentMatchesSearch(target, "nothing-here"), false);
    assert.equal(accidentDayOf(target), "2026-10-01");
  });

  it("sorts newest first", () => {
    const sorted = sortAccidents([
      row("old", { occurred_at: "2026-01-01T00:00:00.000Z" }),
      row("new", { occurred_at: "2026-10-01T00:00:00.000Z" }),
    ]);
    assert.deepEqual(
      sorted.map((entry) => entry.id),
      ["new", "old"],
    );
  });
});

describe("accidentWritePayload", () => {
  it("writes the full field contract from the input and the frozen snapshot", () => {
    const payload = accidentWritePayload(input(), SNAPSHOT, WRITE_OPTIONS);
    assert.equal(payload.reference, "ACC-0001");
    assert.equal(payload.vehicle_id, "veh-1");
    assert.equal(payload.plate_snapshot, "8421");
    assert.equal(payload.vehicle_company_name, "Americana");
    assert.equal(payload.model_year, 2023);
    assert.equal(payload.driver_id, "drv-1");
    assert.equal(payload.driver_name, "Sam Test");
    assert.equal(payload.employee_id, "10043");
    assert.equal(payload.driver_fault, "yes");
    assert.equal(payload.case_status, "pending");
    assert.equal(payload.vehicle_case_status, "case_check");
    assert.equal(payload.source, "admin");
    assert.equal(payload.reviewed_at, null);
    assert.deepEqual(payload.attachment_keys, ["vehicles/veh-1/accidents/a.jpg"]);
    assert.equal(payload.amount_kwd, 120.5);
    const occurred = payload.occurred_at as Date;
    assert.ok(occurred instanceof Date);
    // `datetime-local` values are local wall-clock; compare the instant, not a string.
    assert.equal(occurred.getTime(), new Date("2026-11-01T18:30").getTime());
  });

  it("stores a blank driver fault as blank, never as a third word", () => {
    const payload = accidentWritePayload(input({ driverFault: "" }), SNAPSHOT, WRITE_OPTIONS);
    assert.equal(payload.driver_fault, null);
  });

  it("writes the legacy severity only when one was picked", () => {
    assert.equal(accidentWritePayload(input(), SNAPSHOT, WRITE_OPTIONS).severity, null);
    assert.equal(
      accidentWritePayload(input({ severity: "high" }), SNAPSHOT, WRITE_OPTIONS).severity,
      "high",
    );
  });

  it("caps the attachment list at ten", () => {
    const payload = accidentWritePayload(
      input({ attachmentKeys: Array.from({ length: 14 }, (_, i) => `k${i}`) }),
      SNAPSHOT,
      WRITE_OPTIONS,
    );
    assert.equal((payload.attachment_keys as string[]).length, 10);
  });

  it("keeps identity out of the editable field list", () => {
    const payload = accidentWritePayload(input(), SNAPSHOT, WRITE_OPTIONS);
    const patch = editableAccidentFields(payload);
    assert.equal("reference" in patch, false);
    assert.equal("vehicle_id" in patch, false);
    assert.equal("plate_snapshot" in patch, false);
    assert.equal("source" in patch, false);
    assert.equal("created_at" in patch, false);
    assert.equal("case_status" in patch, true);
    assert.equal("updated_at" in patch, true);
  });
});

