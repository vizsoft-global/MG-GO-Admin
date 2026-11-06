import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { driversListLoadState, driversListShowsEmptySearch } from "./drivers-list-load-state";

describe("driversListLoadState", () => {
  it("keeps loaded rows when a background refetch fails", () => {
    // The reported screen: on coming back to the page the refetch dropped, and
    // the table blanked while the toolbar still read 975.
    const state = driversListLoadState({ isError: true, hasData: true });
    assert.equal(state.hardFailed, false);
    assert.equal(state.refreshFailed, true);
  });

  it("reports a failure with nothing cached as a hard failure", () => {
    const state = driversListLoadState({ isError: true, hasData: false });
    assert.equal(state.hardFailed, true);
    assert.equal(state.refreshFailed, false);
  });

  it("reports no failure while the request is healthy", () => {
    assert.deepEqual(driversListLoadState({ isError: false, hasData: true }), {
      hardFailed: false,
      refreshFailed: false,
    });
    assert.deepEqual(driversListLoadState({ isError: false, hasData: false }), {
      hardFailed: false,
      refreshFailed: false,
    });
  });
});

describe("driversListShowsEmptySearch", () => {
  const base = { loading: false, hardFailed: false, rowCount: 0, hasNarrowing: false, tabTotal: 975 };

  it("never shows a search miss over a failed list", () => {
    assert.equal(driversListShowsEmptySearch({ ...base, hardFailed: true }), false);
  });

  it("never shows a search miss while the first page is still loading", () => {
    assert.equal(driversListShowsEmptySearch({ ...base, loading: true }), false);
  });

  it("shows the search miss when a filter hid a roster that exists", () => {
    assert.equal(driversListShowsEmptySearch(base), true);
    assert.equal(driversListShowsEmptySearch({ ...base, hasNarrowing: true, tabTotal: 0 }), true);
  });

  it("stays quiet when there is genuinely nothing to show and no filter", () => {
    assert.equal(driversListShowsEmptySearch({ ...base, tabTotal: 0 }), false);
  });

  it("stays quiet when rows are present", () => {
    assert.equal(driversListShowsEmptySearch({ ...base, rowCount: 40 }), false);
  });
});
