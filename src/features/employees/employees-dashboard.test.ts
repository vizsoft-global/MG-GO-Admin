import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateEmployeesDashboard } from "./employees-dashboard";

describe("aggregateEmployeesDashboard", () => {
  it("counts live rows and skips archived from the live buckets", () => {
    const out = aggregateEmployeesDashboard([
      {
        archived: false,
        project_key: "talabat",
        partner_id: "p1",
        employee_status_key: "running",
        nationality_category_keys: ["gcc"],
        section_keys: ["ops"],
      },
      {
        archived: false,
        project_key: "talabat",
        partner_id: null,
        employee_status_key: "new",
        nationality_category_keys: [],
        section_keys: ["ops", "night"],
      },
      {
        archived: true,
        project_key: "talabat",
        partner_id: "p1",
        employee_status_key: "running",
        nationality_category_keys: ["gcc"],
        section_keys: ["ops"],
      },
    ]);
    assert.equal(out.total, 2);
    assert.equal(out.archived, 1);
    assert.deepEqual(out.by_project, [{ key: "talabat", count: 2 }]);
    assert.equal(out.by_partner.find((b) => b.key === "unassigned")?.count, 1);
    assert.equal(out.by_section.find((b) => b.key === "ops")?.count, 2);
    assert.equal(out.by_section.find((b) => b.key === "night")?.count, 1);
    assert.equal(out.by_nationality_category.find((b) => b.key === "unassigned")?.count, 1);
  });
});
