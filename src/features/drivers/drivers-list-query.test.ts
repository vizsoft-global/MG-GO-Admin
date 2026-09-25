import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countActiveFilters,
  DEFAULT_DRIVERS_SORT,
  isFilterActive,
  mapDriversPageRow,
  nextSort,
  sanitizeDriversFilters,
  withColumnFilter,
} from "./drivers-list-query";

describe("isFilterActive / sanitizeDriversFilters", () => {
  it("drops empty, unknown and wrong-shaped filters", () => {
    const out = sanitizeDriversFilters({
      name: { contains: "  ali  " },
      mgId: { contains: "" },
      ghost: { contains: "x" },
      todayDeliveries: { min: 2, max: null },
      status: { in: [] },
      riderCategory: { in: ["in_house"] },
    });
    assert.deepEqual(out, {
      name: { contains: "ali" },
      todayDeliveries: { min: 2, max: null },
      riderCategory: { in: ["in_house"] },
    });
    assert.equal(countActiveFilters(out), 3);
    assert.equal(isFilterActive({ contains: "  " }), false);
  });
});

describe("withColumnFilter / nextSort", () => {
  it("sets, clears and cycles sort back to name", () => {
    const added = withColumnFilter({}, "name", { contains: "a" });
    assert.deepEqual(added.name, { contains: "a" });
    assert.deepEqual(withColumnFilter(added, "name", null), {});

    assert.deepEqual(nextSort(DEFAULT_DRIVERS_SORT, "mgId"), { key: "mgId", dir: "asc" });
    assert.deepEqual(nextSort({ key: "mgId", dir: "asc" }, "mgId"), { key: "mgId", dir: "desc" });
    assert.deepEqual(nextSort({ key: "mgId", dir: "desc" }, "mgId"), DEFAULT_DRIVERS_SORT);
  });
});

describe("mapDriversPageRow", () => {
  it("maps MG company tone and client code from the RPC row", () => {
    const row = mapDriversPageRow({
      id: "d1",
      driver_code: "10001",
      mg_id: "1360",
      full_name: "Aadhavan",
      rider_category: "in_house",
      company_key: "mg",
      company_name: "MG",
      company_client_code: "CL-0001",
      company_tone: "mg",
      today_deliveries: 4,
      linked: true,
      is_on_duty: false,
      is_blocked: false,
      restaurant_ids: [],
      restaurant_names: [],
    });
    assert.equal(row.employee_id, "1360");
    assert.equal(row.company_tone, "mg");
    assert.equal(row.company_client_code, "CL-0001");
    assert.equal(row.company_name, "MG");
  });

  it("treats a missing tone as Unassigned", () => {
    const row = mapDriversPageRow({
      id: "d2",
      driver_code: "10002",
      full_name: "Dave",
      company_tone: "nope",
    });
    assert.equal(row.company_tone, "unassigned");
    assert.equal(row.employee_id, null);
  });
});
