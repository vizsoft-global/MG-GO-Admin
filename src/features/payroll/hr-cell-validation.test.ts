import assert from "node:assert/strict";
import test from "node:test";
import {
  HR_FOOD_VALUES,
  hrCellError,
  hrInvalidCellField,
  parseHrAmount,
} from "./hr-cell-validation";

test("the 2-year and 4-year increment is an amount, not a closed list", () => {
  // The reported defect: typing 3 was refused by the server and the cell fell
  // back to 0.
  assert.equal(hrCellError("twoYear", 3), null);
  assert.equal(hrCellError("fourYear", 3), null);
  assert.equal(hrCellError("twoYear", 0), null);
  assert.equal(hrCellError("fourYear", 125.5), null);
  assert.equal(hrCellError("twoYear", -5), "negative");
  assert.equal(hrCellError("fourYear", Number.NaN), "not_a_number");
});

test("food stays a fixed list and sick stays 0-30 whole days", () => {
  for (const value of HR_FOOD_VALUES) assert.equal(hrCellError("food", value), null);
  assert.equal(hrCellError("food", 10), "food_list");
  assert.equal(hrCellError("sick", 0), null);
  assert.equal(hrCellError("sick", 30), null);
  assert.equal(hrCellError("sick", 31), "sick_range");
  assert.equal(hrCellError("sick", 2.5), "sick_range");
  assert.equal(hrCellError("sick", -1), "sick_range");
});

test("money cells refuse a negative amount", () => {
  for (const field of ["pending", "traffic", "loan", "allowances", "deductions"] as const) {
    assert.equal(hrCellError(field, 0), null, field);
    assert.equal(hrCellError(field, 12.75), null, field);
    assert.equal(hrCellError(field, -1), "negative", field);
  }
});

test("a typed amount is parsed the way the operator reads it", () => {
  assert.equal(parseHrAmount("3"), 3);
  assert.equal(parseHrAmount(" 1,250.5 "), 1250.5);
  assert.equal(parseHrAmount(""), null);
  assert.equal(parseHrAmount("abc"), null);
  assert.equal(parseHrAmount("-5"), -5);
});

test("a server refusal names the field it refused", () => {
  assert.equal(hrInvalidCellField("invalid_cell:two_year_applicable"), "two_year_applicable");
  assert.equal(hrInvalidCellField("invalid_cell"), null);
  assert.equal(hrInvalidCellField("invalid_month"), null);
});
