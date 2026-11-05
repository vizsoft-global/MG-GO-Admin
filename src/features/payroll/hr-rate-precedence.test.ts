import assert from "node:assert/strict";
import test from "node:test";
import { duplicateRateLine, matchHrRates, type HrRateLine } from "./hr-rate";

const BASE = { id: "x", vehicle: "Bike" as const, project: "Keeta", zones: ["Salmiya"], rate: 0.3 };

function line(over: Partial<HrRateLine>): HrRateLine {
  return { ...BASE, ...over, id: over.id ?? Math.random().toString(36).slice(2) };
}

const RIDER = { vehicleKey: "bike", positionKey: "rider", projects: ["Keeta"], zone: "Salmiya" };

test("a position line beats the wildcard for the same vehicle, project and zone", () => {
  const hits = matchHrRates({
    ...RIDER,
    lines: [line({ rate: 0.3 }), line({ position: "rider", rate: 0.4 })],
  });
  assert.equal(hits.length, 1, "one order must not be priced twice");
  assert.equal(hits[0].rate, 0.4);
  assert.equal(hits[0].position, "rider");
});

test("a position line does not price a rider in another position", () => {
  const hits = matchHrRates({
    ...RIDER,
    positionKey: "light_driver",
    lines: [line({ rate: 0.3 }), line({ position: "rider", rate: 0.4 })],
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rate, 0.3, "falls back to the wildcard");
});

test("an exact vehicle-type line beats the Bike/Car bucket", () => {
  const hits = matchHrRates({
    vehicleKey: "van",
    projects: ["Keeta"],
    zone: "Salmiya",
    lines: [line({ vehicle: "Car", rate: 0.3 }), line({ vehicle: "Car", vehicleKey: "van", rate: 0.5 })],
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rate, 0.5);
});

test("a van line never prices a bike rider", () => {
  const hits = matchHrRates({
    ...RIDER,
    lines: [line({ vehicle: "Car", vehicleKey: "van", rate: 0.5 })],
  });
  assert.equal(hits.length, 0);
});

test("each project still contributes its own best rate", () => {
  const hits = matchHrRates({
    ...RIDER,
    projects: ["Keeta", "Americana"],
    lines: [line({ rate: 0.3 }), line({ project: "Americana", rate: 0.25 })],
  });
  assert.equal(hits.length, 2);
  assert.equal(hits.reduce((sum, hit) => sum + hit.rate, 0), 0.55);
});

test("a duplicate vehicle/project/zone/position line is refused, a wildcard pair is not", () => {
  const wildcard = line({});
  const specific = line({ position: "rider", rate: 0.4 });
  assert.equal(duplicateRateLine([wildcard, specific], specific), null);
  const twin = line({ rate: 0.35 });
  assert.ok(duplicateRateLine([wildcard, twin], twin), "same key twice must be refused");
  const otherZone = line({ zones: ["Hawally"] });
  assert.equal(duplicateRateLine([wildcard, otherZone], otherZone), null);
});
