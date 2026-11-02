import assert from "node:assert/strict";
import { test } from "node:test";
import { formatKwd, formatKwdAxis } from "./money";

test("formatKwd prints one decimal with thousands separators", () => {
  assert.equal(formatKwd(0), "0.0");
  assert.equal(formatKwd(25), "25.0");
  assert.equal(formatKwd(25.25), "25.3");
  assert.equal(formatKwd(1250), "1,250.0");
  assert.equal(formatKwd("12.04"), "12.0");
});

test("formatKwd never falls back to exponent notation", () => {
  // Number.prototype.toFixed(1) answers "2.3456709654312343e+21" here.
  const huge = formatKwd(2.3456709654312343e21);
  assert.ok(!huge.includes("e"), huge);
  assert.equal(huge, "2,345,670,965,431,234,200,000.0");
  assert.ok(!formatKwd(1e21).includes("e"));
});

test("formatKwd prints an em dash for a missing or broken value", () => {
  assert.equal(formatKwd(null), "\u2014");
  assert.equal(formatKwd(undefined), "\u2014");
  assert.equal(formatKwd(""), "\u2014");
  assert.equal(formatKwd(Number.NaN), "\u2014");
  assert.equal(formatKwd(Number.POSITIVE_INFINITY), "\u2014");
});

test("formatKwdAxis shortens only the axis tick", () => {
  assert.equal(formatKwdAxis(0), "0");
  assert.equal(formatKwdAxis(25), "25");
  assert.equal(formatKwdAxis(1200), "1.2K");
  assert.equal(formatKwdAxis(2_500_000), "2.5M");
  assert.equal(formatKwdAxis(null), "\u2014");
  assert.ok(!formatKwdAxis(1e75).includes("e"));
});
