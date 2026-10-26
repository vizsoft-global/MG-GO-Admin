import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kuwaitClock, ordinalDay } from "./kuwait-clock";
import { formatTempC, parseOpenMeteo, weatherKind } from "./weather";

describe("launcher chrome", () => {
  it("builds English ordinals", () => {
    assert.equal(ordinalDay(1), "1st");
    assert.equal(ordinalDay(2), "2nd");
    assert.equal(ordinalDay(3), "3rd");
    assert.equal(ordinalDay(11), "11th");
    assert.equal(ordinalDay(15), "15th");
    assert.equal(ordinalDay(21), "21st");
  });

  it("formats the Kuwait clock", () => {
    const clock = kuwaitClock(new Date("2026-10-15T09:23:00Z"), "en");
    assert.equal(clock.weekday, "Thu");
    assert.equal(clock.dayLabel, "15th");
    assert.equal(clock.month, "October");
    assert.match(clock.time, /12:23/);
  });

  it("keeps the Arabic day as a bare number", () => {
    const clock = kuwaitClock(new Date("2026-10-15T09:23:00Z"), "ar");
    assert.equal(clock.dayLabel, "15");
    assert.notEqual(clock.month, "October");
  });

  it("rounds temperature with a lowercase c", () => {
    assert.equal(formatTempC(23.6), "24°c");
  });

  it("maps Open-Meteo codes", () => {
    assert.equal(weatherKind(0), "clear");
    assert.equal(weatherKind(61), "rain");
    assert.equal(weatherKind(95), "storm");
  });

  it("parses a live forecast and a failed fetch", () => {
    assert.deepEqual(
      parseOpenMeteo({ current: { temperature_2m: 24.2, weather_code: 0, is_day: 1 } }),
      { tempC: 24.2, code: 0, isDay: true },
    );
    assert.deepEqual(parseOpenMeteo(null), { tempC: null, code: null, isDay: true });
  });
});
