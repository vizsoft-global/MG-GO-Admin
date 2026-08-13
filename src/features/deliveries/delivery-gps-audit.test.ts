import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { haversineMeters } from "@/features/locations/location-status";
import {
  pickupDeliveryDistanceMeters,
  trailPathFromEvents,
} from "./delivery-gps-audit";

describe("pickupDeliveryDistanceMeters", () => {
  it("measures pickup to delivery, not tracking-event vs delivery (which can be 0 m)", () => {
    const pickup = { lat: 29.3759, lng: 47.9774 };
    const delivery = { lat: 29.3859, lng: 47.9874 };
    const meters = pickupDeliveryDistanceMeters(pickup, delivery);
    assert.ok(meters != null && meters > 1000);
    assert.equal(
      Math.round(meters!),
      Math.round(haversineMeters(pickup.lat, pickup.lng, delivery.lat, delivery.lng)),
    );
  });

  it("returns null when a coordinate is missing", () => {
    assert.equal(
      pickupDeliveryDistanceMeters({ lat: 29.37, lng: 47.97 }, { lat: null, lng: 47.98 }),
      null,
    );
  });
});

describe("trailPathFromEvents", () => {
  it("orders GPS samples in time so the map can draw the traveled path", () => {
    const path = trailPathFromEvents([
      { latitude: 29.38, longitude: 47.98, recordedAt: "2026-08-13T10:02:00.000Z" },
      { latitude: 29.37, longitude: 47.97, recordedAt: "2026-08-13T10:00:00.000Z" },
      { latitude: 29.39, longitude: 47.99, recordedAt: "2026-08-13T10:04:00.000Z" },
    ]);
    assert.deepEqual(path, [
      { lat: 29.37, lng: 47.97 },
      { lat: 29.38, lng: 47.98 },
      { lat: 29.39, lng: 47.99 },
    ]);
  });
});
