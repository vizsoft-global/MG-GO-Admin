import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEAVE_SLOTS,
  LEAVE_TYPES,
  addDayLabel,
  buildEsignDocumentLayout,
  leaveDaysBetween,
  slotsForKind,
} from "./esign-document-layout";
import { employeeRowRank, sortEmployeeRows } from "../employee-block";
import type { EsignEmployeeSnapshot } from "./esign-placeholders";

/**
 * The client's Leave Request sheet, and the one employee order every template
 * now prints. Both are contract, not styling: five boxes that take ink, and a
 * block whose first five rows are the same on every document.
 */

const EMPLOYEE: EsignEmployeeSnapshot = {
  company_name: "Musallam Delivery",
  employee_name: "ABDULLAH AL-MUTAIRI",
  employee_id: "10042",
  driver_code: "10042",
  civil_id: "284091200123",
  joined_at: "2024-03-12",
  accommodation: "Hawally camp",
  zone: "Hawally",
  project: "Americana",
  nationality: "Kuwaiti",
  position: "Rider",
  sponsor: "Musallam",
  pay_through: "2026-10-31",
  bank_number: "KW81NBOK00000000000000001041",
};

function leaveLayout(fields: { key: string; labelEn: string; value: string }[] = []) {
  return buildEsignDocumentLayout({
    kind: "leave",
    employee: EMPLOYEE,
    requestCode: "SIG-1500",
    dateLabel: "03/11/2026",
    fields: fields.map((row) => ({
      key: row.key,
      labelEn: row.labelEn,
      labelAr: row.labelEn,
      value: row.value,
      section: "document" as const,
    })),
  });
}

describe("leave request slots", () => {
  it("prints five signed boxes and every one is usable", () => {
    assert.equal(LEAVE_SLOTS.length, 5);
    assert.deepEqual(
      LEAVE_SLOTS.map((slot) => slot.role),
      ["employee", "direct_manager", "hr_responsibility", "hr_manager", "general_manager"],
    );
    for (const slot of LEAVE_SLOTS) {
      assert.equal(slot.page, 1);
      assert.ok(slot.wPt >= 8 && slot.hPt >= 8, `${slot.role} too small`);
    }
  });

  it("keeps the five boxes on one row inside the content column", () => {
    const tops = new Set(LEAVE_SLOTS.map((slot) => slot.yPt));
    assert.equal(tops.size, 1, "boxes do not share a row");
    const first = LEAVE_SLOTS[0];
    const last = LEAVE_SLOTS[4];
    assert.ok(first && last);
    // 24pt inset either side of the 547pt content column.
    assert.ok(first.xPt >= 20);
    assert.ok(last.xPt + last.wPt <= 595.28 - 20);
    // No overlap between neighbours.
    for (let i = 1; i < LEAVE_SLOTS.length; i += 1) {
      const previous = LEAVE_SLOTS[i - 1];
      const current = LEAVE_SLOTS[i];
      assert.ok(previous && current);
      assert.ok(current.xPt >= previous.xPt + previous.wPt, `${current.role} overlaps`);
    }
  });

  it("routes the leave kind to its own boxes", () => {
    assert.deepEqual(slotsForKind("leave"), LEAVE_SLOTS);
  });
});

describe("leave request layout", () => {
  it("titles itself and prints the client's five sections", () => {
    const layout = leaveLayout();
    assert.deepEqual(layout.title, { en: "Leave Request", ar: "طلب إجازة" });
    const keys = layout.sections.map((section) => section.key);
    for (const key of ["type_of_leave", "leave_period", "direct_manager", "hr_use", "leave_policy"]) {
      assert.ok(keys.includes(key), `missing ${key}`);
    }
  });

  it("opens the employee block in the client's order", () => {
    const layout = leaveLayout();
    assert.deepEqual(
      layout.employeeRows.map((row) => row.key),
      ["employee_id", "employee_name", "sponsor", "civil_id", "position"],
    );
  });

  it("ticks exactly the leave type that was chosen", () => {
    const layout = leaveLayout([{ key: "leave_type", labelEn: "Type of leave", value: "sick" }]);
    const section = layout.sections.find((row) => row.key === "type_of_leave");
    assert.ok(section?.checkboxes);
    assert.equal(section.checkboxes.length, LEAVE_TYPES.length);
    const ticked = section.checkboxes.filter((check) => check.checked).map((check) => check.key);
    assert.deepEqual(ticked, ["sick"]);
  });

  it("accepts the label as well as the key", () => {
    const layout = leaveLayout([
      { key: "leave_type", labelEn: "Type of leave", value: "Annual Leave" },
    ]);
    const section = layout.sections.find((row) => row.key === "type_of_leave");
    const ticked = section?.checkboxes?.filter((check) => check.checked).map((check) => check.key);
    assert.deepEqual(ticked, ["annual"]);
  });

  it("leaves every type unticked when the value matches none", () => {
    const layout = leaveLayout([{ key: "leave_type", labelEn: "Type of leave", value: "holiday" }]);
    const section = layout.sections.find((row) => row.key === "type_of_leave");
    assert.equal(section?.checkboxes?.filter((check) => check.checked).length, 0);
  });

  it("fills the period and computes the day count", () => {
    const layout = leaveLayout([
      { key: "leave_from", labelEn: "Starting date", value: "2026-11-10" },
      { key: "leave_to", labelEn: "Ending date", value: "2026-11-14" },
    ]);
    const period = layout.sections.find((row) => row.key === "leave_period");
    const value = (key: string) => period?.rows.find((row) => row.key === key)?.value;
    assert.equal(value("leave_from"), "2026-11-10");
    assert.equal(value("leave_to"), "2026-11-14");
    // 10–14 November inclusive is five days.
    assert.equal(value("leave_days"), "5");
  });

  it("prints the employment date and resume date the record already knows", () => {
    const layout = leaveLayout([
      { key: "leave_to", labelEn: "Ending date", value: "2026-11-14" },
    ]);
    const hr = layout.sections.find((row) => row.key === "hr_use");
    const value = (key: string) => hr?.rows.find((row) => row.key === key)?.value;
    assert.equal(value("date_of_employment"), "2024-03-12");
    assert.equal(value("resume_date"), "2026-11-15");
    // The balance is HR's own figure: nothing invents it.
    assert.equal(value("leave_balance"), "");
  });

  it("keeps HR's typed figures over the derived ones", () => {
    const layout = leaveLayout([
      { key: "leave_from", labelEn: "Starting date", value: "2026-11-10" },
      { key: "leave_to", labelEn: "Ending date", value: "2026-11-14" },
      { key: "actual_leave_days", labelEn: "Actual days", value: "4" },
      { key: "leave_balance", labelEn: "Balance", value: "18" },
    ]);
    const hr = layout.sections.find((row) => row.key === "hr_use");
    const value = (key: string) => hr?.rows.find((row) => row.key === key)?.value;
    assert.equal(value("actual_leave_days"), "4");
    assert.equal(value("leave_balance"), "18");
  });

  it("prints the seven policies in both languages", () => {
    const layout = leaveLayout();
    const policy = layout.sections.find((row) => row.key === "leave_policy");
    assert.ok(policy?.body);
    assert.equal(policy.body.en.split("\n").length, 7);
    assert.equal(policy.body.ar.split("\n").length, 7);
  });
});

describe("leave date arithmetic", () => {
  it("counts inclusive days", () => {
    assert.equal(leaveDaysBetween("2026-11-10", "2026-11-10"), "1");
    assert.equal(leaveDaysBetween("2026-11-10", "2026-11-14"), "5");
    assert.equal(leaveDaysBetween("2026-10-30", "2026-11-02"), "4");
  });

  it("refuses to invent a number it cannot derive", () => {
    assert.equal(leaveDaysBetween("", "2026-11-14"), "");
    assert.equal(leaveDaysBetween("2026-11-10", ""), "");
    assert.equal(leaveDaysBetween("2026-11-14", "2026-11-10"), "");
    assert.equal(leaveDaysBetween("10/11/2026", "2026-11-14"), "");
  });

  it("moves a day label forward", () => {
    assert.equal(addDayLabel("2026-11-14", 1), "2026-11-15");
    assert.equal(addDayLabel("2026-11-30", 1), "2026-12-01");
    assert.equal(addDayLabel("", 1), "");
  });
});

describe("employee block order on every template", () => {
  it("ranks the client's five fields first", () => {
    assert.equal(employeeRowRank("employee_id"), 0);
    assert.equal(employeeRowRank("employee_name"), 1);
    assert.equal(employeeRowRank("sponsor"), 2);
    assert.equal(employeeRowRank("civil_id"), 3);
    assert.equal(employeeRowRank("position"), 4);
    // Anything else sorts after the five, and all of them share one rank.
    assert.equal(employeeRowRank("company_name"), 5);
    assert.equal(employeeRowRank("bank_number"), 5);
  });

  it("keeps the caller's order among the unnamed fields", () => {
    const sorted = sortEmployeeRows([
      { key: "company_name" },
      { key: "civil_id" },
      { key: "accommodation" },
      { key: "employee_name" },
      { key: "employee_id" },
    ]);
    assert.deepEqual(
      sorted.map((row) => row.key),
      ["employee_id", "employee_name", "civil_id", "company_name", "accommodation"],
    );
  });

  it("applies to a loan sheet as well as a leave sheet", () => {
    const layout = buildEsignDocumentLayout({ kind: "loan", employee: EMPLOYEE });
    const keys = layout.employeeRows.map((row) => row.key);
    assert.ok(keys.indexOf("employee_name") < keys.indexOf("civil_id"));
    assert.ok(keys.indexOf("civil_id") < keys.indexOf("position"));
  });

  it("applies to a generic document", () => {
    const layout = buildEsignDocumentLayout({ kind: "general", employee: EMPLOYEE });
    assert.deepEqual(
      layout.employeeRows.slice(0, 5).map((row) => row.key),
      ["employee_id", "employee_name", "sponsor", "civil_id", "position"],
    );
  });
});
