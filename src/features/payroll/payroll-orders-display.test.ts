import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aoShownOrders,
  foldPayrollDayOrders,
  lookupReconCount,
  lookupReconOrders,
  reconLookupKeys,
} from "./payroll-orders-display";

describe("reconLookupKeys", () => {
  it("dedupes employee id and driver code", () => {
    assert.deepEqual(reconLookupKeys(" 108899 ", "108899", "10001"), ["108899", "10001"]);
  });
});

describe("lookupReconOrders", () => {
  it("matches driver code when employee id misses", () => {
    const byId = new Map([["10001", new Map([["2026-10-01", 7]])]]);
    assert.equal(lookupReconOrders(byId, "2026-10-01", "108899", "10001"), 7);
    assert.equal(lookupReconOrders(byId, "2026-10-01", "108899"), null);
  });
});

describe("lookupReconCount", () => {
  it("reads employee_id|day then driver_code|day", () => {
    const map = new Map([["10001|2026-10-01", { orders: 4 }]]);
    assert.equal(lookupReconCount(map, "2026-10-01", "108899", "10001"), 4);
  });
});

describe("foldPayrollDayOrders", () => {
  it("lets a manual 0 replace recon and verified", () => {
    assert.deepEqual(foldPayrollDayOrders({ o: 4, do: 12, mo: 0 }), {
      orders: 0,
      displayOrders: 0,
      overridden: true,
    });
  });

  it("keeps recon display when there is no override", () => {
    assert.deepEqual(foldPayrollDayOrders({ o: 4, do: 12, mo: null }), {
      orders: 4,
      displayOrders: 12,
      overridden: false,
    });
  });
});

describe("aoShownOrders", () => {
  it("prefers displayOrders and leaves rule orders untouched", () => {
    assert.equal(aoShownOrders({ orders: 0, displayOrders: 12 }), 12);
    assert.equal(aoShownOrders({ orders: 3 }), 3);
    assert.equal(aoShownOrders(null), 0);
  });
});
