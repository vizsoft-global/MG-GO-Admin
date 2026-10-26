import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  importRosterDriversAoa,
  rosterCells,
  type ImportRosterSource,
} from "./import-roster-sheet";

function source(partial: Partial<ImportRosterSource> = {}): ImportRosterSource {
  return {
    intake: { full_name: "Intake Name", employee_id: "1001", civil_id: "123456789012" },
    driver: null,
    profileName: "",
    profilePhone: "",
    zoneName: "",
    restaurantNames: [],
    vehicleLabel: "",
    partnerName: "",
    companyName: "",
    statusLabel: "",
    sectionLabels: [],
    nationalityLabels: [],
    sponsorshipLabel: "",
    bankLabel: "",
    assetNames: [],
    expiry: {},
    offDays: null,
    accountActive: false,
    includeBank: true,
    ...partial,
  };
}

const columns = [
  { field: "full_name", header: "Full Name" },
  { field: "employee_id", header: "MG ID" },
  { field: "zone_id", header: "Zone ID" },
  { field: "restaurant_ids", header: "Restaurant IDs" },
  { field: "off_days", header: "Number of OFFs" },
  { field: "active", header: "Active (yes/no)" },
  { field: "bank_code", header: "Bank" },
  { field: "account_number", header: "Account number" },
  { field: "screenshots_allowed", header: "Screenshots allowed (yes/no)" },
  { field: "fixed_salary", header: "Fixed salary" },
  { field: "civil_id_expiry", header: "Civil ID expiry" },
  { field: "cf:visa", header: "Visa" },
];

describe("import roster sheet", () => {
  it("writes the import headers and the resolved names", () => {
    const cells = rosterCells(
      source({
        profileName: "Aadhavan",
        zoneName: "Jahra",
        restaurantNames: ["Hardee's", "KFC"],
        offDays: 3,
        accountActive: true,
        bankLabel: "NBK",
        driver: {
          employee_id: "1360",
          bank_details: { account_number: "9988" },
          screenshots_allowed: false,
          fixed_salary: 12.5,
          custom_fields: { visa: "V-1" },
        },
        expiry: { civil_id_expiry: "2027-01-15" },
      }),
    );
    const aoa = importRosterDriversAoa(columns, [cells]);
    assert.deepEqual(aoa[0], columns.map((column) => column.header));
    assert.deepEqual(aoa[1], [
      "Aadhavan",
      "1360",
      "Jahra",
      "Hardee's, KFC",
      "3",
      "yes",
      "NBK",
      "9988",
      "no",
      "12.500",
      "2027-01-15",
      "V-1",
    ]);
  });

  it("leaves OFF blank when this month has no row and hides bank without the tick", () => {
    const cells = rosterCells(
      source({
        includeBank: false,
        bankLabel: "NBK",
        intake: {
          employee_id: "1001",
          bank_details: { account_number: "9988", bank_code: "nbk" },
          screenshots_allowed: true,
        },
      }),
    );
    assert.equal(cells.off_days, "");
    assert.equal(cells.active, "no");
    assert.equal(cells.bank_code, "");
    assert.equal(cells.account_number, "");
    assert.equal(cells.screenshots_allowed, "yes");
    assert.equal(cells.employee_id, "1001");
  });

  it("keeps a live empty value instead of the intake copy", () => {
    const cells = rosterCells(
      source({
        driver: { civil_id: null, employee_id: "1001" },
        zoneName: "zone-1",
      }),
    );
    assert.equal(cells.civil_id, "");
    assert.equal(cells.zone_id, "zone-1");
  });
});
