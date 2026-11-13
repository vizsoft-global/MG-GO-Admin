import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * The owner's rule: the admin panel shows no street address. A rider's place is
 * coordinates and a zone name. The lookups that used to be here asked Google's
 * geocoder on every GPS fix of the selected rider, against a key that has no
 * Geocoding API.
 */
describe("the panel shows no street address", () => {
  it("has no geocoder call anywhere in the panel source", () => {
    const root = new URL("../../", import.meta.url);
    const offenders: string[] = [];
    for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      const file = entry.replaceAll("\\", "/");
      if (!/\.tsx?$/.test(file) || file.endsWith(".test.ts")) continue;
      const source = readFileSync(new URL(file, root), "utf8");
      if (/maps\??\.Geocoder|\.geocode\(|formatted_address/.test(source)) offenders.push(file);
    }
    assert.deepEqual(offenders, []);
  });
});
