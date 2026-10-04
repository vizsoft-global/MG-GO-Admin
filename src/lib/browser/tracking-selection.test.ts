import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRIVER_QUERY_PARAM,
  LEGACY_DRIVER_QUERY_PARAM,
  selectedDriverIdFromSearch,
  withSelectedDriverId,
} from "./tracking-selection";

const UUID = "11111111-2222-3333-4444-555555555555";

describe("tracking selection URL (QA #49)", () => {
  it("reads the canonical parameter, with or without the leading question mark", () => {
    assert.equal(selectedDriverIdFromSearch(`?driver=${UUID}`), UUID);
    assert.equal(selectedDriverIdFromSearch(`driver=${UUID}`), UUID);
  });

  it("still reads the spelling three pages already link with", () => {
    // /attendance, /driver-shifts and /worktime emit `?driverId=` — nothing wrote `driver` yet,
    // so accepting the legacy name is what makes those existing links open a rider.
    assert.equal(selectedDriverIdFromSearch(`?driverId=${UUID}`), UUID);
    // The canonical one wins when both are present, so the two can never disagree.
    assert.equal(selectedDriverIdFromSearch(`?driver=${UUID}&driverId=other`), UUID);
  });

  it("treats an empty value as no selection", () => {
    assert.equal(selectedDriverIdFromSearch("?driver="), null);
    assert.equal(selectedDriverIdFromSearch(""), null);
    assert.equal(selectedDriverIdFromSearch("?zone=all"), null);
  });

  it("keeps the locale in the pathname", () => {
    // The locale lives in the path, so the path is passed through untouched — a URL assembled
    // from next-intl's `usePathname` (which strips it) would turn /en into a bare path.
    assert.equal(
      withSelectedDriverId("/en/live-tracking", "", UUID),
      `/en/live-tracking?driver=${UUID}`,
    );
  });

  it("preserves every other query parameter and consumes the legacy spelling", () => {
    assert.equal(
      withSelectedDriverId("/ar/live-tracking-v2", "?zone=z1&driverId=old&alerts=1", UUID),
      `/ar/live-tracking-v2?zone=z1&alerts=1&driver=${UUID}`,
    );
  });

  it("removes the parameter when nothing is selected, leaving the rest alone", () => {
    assert.equal(
      withSelectedDriverId("/en/live-tracking", `?driver=${UUID}&zone=z1`, null),
      "/en/live-tracking?zone=z1",
    );
    assert.equal(
      withSelectedDriverId("/en/live-tracking", `?${DRIVER_QUERY_PARAM}=x`, null),
      "/en/live-tracking",
    );
    assert.equal(
      withSelectedDriverId("/en/live-tracking", `?${LEGACY_DRIVER_QUERY_PARAM}=x`, null),
      "/en/live-tracking",
    );
  });
});
