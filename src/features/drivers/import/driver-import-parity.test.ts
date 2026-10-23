import assert from "node:assert/strict";
import test from "node:test";
import { buildImportWritePatch, duplicateHeaderFields, writesCell } from "./driver-import-patch";
import { clearRedo, redoRowPlan, undoRowPlan } from "./driver-import-stack";
import { resolveTemplateColumns, templateDriversAoa } from "./template";
import { DRIVER_IMPORT_FIELDS, type DriverImportMappedRow } from "../types";

function row(over: Partial<DriverImportMappedRow> = {}): DriverImportMappedRow {
  return {
    full_name: "Ada",
    phone: null,
    civil_id: null,
    employee_id: "MG1",
    passport_number: null,
    partner_id: null,
    zone_id: null,
    vehicle_label: null,
    vehicle_type: null,
    restaurant_ids: null,
    nationality: null,
    nationality_category_keys: null,
    rider_category: null,
    source_company: null,
    client_id: null,
    client_name: null,
    active: null,
    off_days: null,
    employee_status_key: null,
    section_keys: null,
    project_key: null,
    accommodation: null,
    work_start_date: "2024-01-15",
    screenshots_allowed: null,
    login_verification_exempt: null,
    bank_code: "cash",
    account_number: "123456",
    iban: "KW00",
    beneficiary_civil_id: null,
    license_expiry: null,
    civil_id_expiry: null,
    work_permit_expiry: null,
    passport_expiry: null,
    health_card_expiry: null,
    operations_card_expiry: null,
    sponsorship_key: null,
    job_position: null,
    hiring_type: null,
    job_end_date: null,
    job_end_description: null,
    residency_expiry_date: null,
    fixed_salary: null,
    work_permit_salary: null,
    last_increment_date: null,
    currency: null,
    asset_ids: null,
    custom_fields: {},
    present: { full_name: true, employee_id: true, work_start_date: true, bank_code: true, account_number: true },
    cleared: {},
    ...over,
  };
}

test("two fields on one header are a duplicate", () => {
  const fields = duplicateHeaderFields({ full_name: "Name", phone: "Name" });
  assert.deepEqual(fields.sort(), ["full_name", "phone"]);
});

test("a missing column is not written", () => {
  const patch = buildImportWritePatch({
    row: row(),
    mode: "update",
    resolved: { full_name: "Ada", employee_id: "MG1", work_start_date: "2024-01-15" },
    existingCustom: {},
    existingBank: null,
  });
  assert.equal("phone" in patch.intake, false);
});

test("a dash clears the cell", () => {
  const patch = buildImportWritePatch({
    row: row({ present: { phone: true }, cleared: { phone: true }, phone: null }),
    mode: "update",
    resolved: {},
    existingCustom: {},
    existingBank: null,
  });
  assert.equal(patch.intake.phone, null);
  assert.equal(writesCell({ present: { phone: true }, cleared: { phone: true } }, "phone", false, "update"), true);
});

test("work start is stored as work_start_date", () => {
  const patch = buildImportWritePatch({
    row: row(),
    mode: "create",
    resolved: { full_name: "Ada", employee_id: "MG1", work_start_date: "2024-01-15" },
    existingCustom: {},
    existingBank: null,
  });
  assert.equal(patch.intake.work_start_date, "2024-01-15");
});

test("cash bank drops the account and IBAN", () => {
  const patch = buildImportWritePatch({
    row: row(),
    mode: "update",
    resolved: { bank_code: "cash" },
    existingCustom: {},
    existingBank: { bank_code: "nbk", account_number: "999999", iban: "KW11", beneficiary_civil_id: null, currency: "KWD" },
  });
  const bank = patch.intake.bank_details as { account_number: string | null; iban: string | null };
  assert.equal(bank.account_number, null);
  assert.equal(bank.iban, null);
});

test("undo and redo plans", () => {
  const created = {
    batch_id: "b",
    row_index: 0,
    outcome: "create" as const,
    intake_id: "i",
    driver_id: "d",
    created_auth_uid: "u",
    passcode: "1",
    before: null,
    after: { intake: {}, driver: null, profile: null, restaurant_ids: [], asset_ids: [], tracking: [], off_days: null, driver_code: null },
  };
  assert.equal(undoRowPlan(created), "delete");
  assert.equal(redoRowPlan(created), "write");
  const updated = { ...created, outcome: "update" as const, before: created.after, created_auth_uid: null };
  assert.equal(undoRowPlan(updated), "restore");
});

test("the sample template lists every writable column", () => {
  const columns = resolveTemplateColumns(null);
  const headers = templateDriversAoa(columns)[0] ?? [];
  assert.deepEqual(
    [...columns.map((column) => column.field)].sort(),
    [...DRIVER_IMPORT_FIELDS].sort(),
  );
  assert.equal(headers.length, DRIVER_IMPORT_FIELDS.length);
  assert.equal(new Set(headers).size, headers.length);
});

test("a new apply retires older redo", () => {
  const next = clearRedo([
    { id: "old", status: "undone", createdAt: "1", undoSeq: 1, redoable: true },
    { id: "fresh", status: "applied", createdAt: "2", undoSeq: 0, redoable: true },
  ]);
  assert.deepEqual(next, ["old"]);
});
