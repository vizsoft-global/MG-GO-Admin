import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardScopeForState,
  dateFieldForBucket,
  EMPTY_NOTIFICATION_FILTERS,
  isMetricCardSelected,
  listFiltersForState,
  metricCardScope,
  notificationFiltersToQuery,
  parseNotificationFilters,
  toggleMetricCard,
} from "./notification-filter-state";

const TODAY = "2026-11-06";
const RANGED = { ...EMPTY_NOTIFICATION_FILTERS, from: "2026-11-05", to: "2026-11-06" };

test("sent today pins its own day, other cards only swap the bucket", () => {
  assert.deepEqual(metricCardScope(EMPTY_NOTIFICATION_FILTERS, "sentToday", TODAY), {
    ...EMPTY_NOTIFICATION_FILTERS,
    bucket: "sent",
    from: TODAY,
    to: TODAY,
  });
  for (const card of ["scheduled", "drafts", "failed"] as const) {
    assert.deepEqual(metricCardScope(EMPTY_NOTIFICATION_FILTERS, card, TODAY), {
      ...EMPTY_NOTIFICATION_FILTERS,
      bucket: card,
    });
  }
});

test("a card's scope produces the same grid filters as the grid itself", () => {
  for (const card of ["scheduled", "drafts", "failed"] as const) {
    const cardState = metricCardScope(RANGED, card, TODAY);
    const grid = listFiltersForState(cardState, "");
    assert.equal(grid.bucket, card);
    assert.equal(grid.fromDate, RANGED.from);
    assert.equal(grid.toDate, RANGED.to);
    assert.equal(grid.dateField, dateFieldForBucket(card));
    // The card counts under the very same category / creator / period / search scope.
    assert.deepEqual(dashboardScopeForState(cardState, ""), dashboardScopeForState(RANGED, ""));
  }
});

test("category, creator and search narrow the grid and the cards together", () => {
  const state = {
    ...EMPTY_NOTIFICATION_FILTERS,
    bucket: "drafts" as const,
    category: "promo",
    createdBy: "u1",
  };
  assert.deepEqual(listFiltersForState(state, "eid"), {
    bucket: "drafts",
    category: "promo",
    createdBy: "u1",
    dateField: "created_at",
    search: "eid",
  });
  assert.deepEqual(dashboardScopeForState(state, "eid"), {
    category: "promo",
    createdBy: "u1",
    search: "eid",
  });
});

test("the drafts card keeps the grid's period so its number matches the rows it opens", () => {
  const scope = metricCardScope(RANGED, "drafts", TODAY);
  assert.equal(scope.bucket, "drafts");
  assert.equal(scope.from, "2026-11-05");
  assert.equal(scope.to, "2026-11-06");
});

test("a metric card toggle keeps category, creator and period", () => {
  const state = { ...RANGED, category: "promo", createdBy: "u1" };
  const next = toggleMetricCard(state, "failed", TODAY);
  assert.equal(next.bucket, "failed");
  assert.equal(next.category, "promo");
  assert.equal(next.createdBy, "u1");
  assert.equal(next.from, "2026-11-05");
  assert.equal(next.to, "2026-11-06");
});

test("clicking the active card clears its bucket; sent today also drops its pinned day", () => {
  const sentToday = toggleMetricCard(RANGED, "sentToday", TODAY);
  assert.deepEqual(toggleMetricCard(sentToday, "sentToday", TODAY), EMPTY_NOTIFICATION_FILTERS);

  const drafts = toggleMetricCard(RANGED, "drafts", TODAY);
  assert.deepEqual(toggleMetricCard(drafts, "drafts", TODAY), RANGED);
});

test("a card is selected only when its bucket and period match its scope", () => {
  const drafts = toggleMetricCard(EMPTY_NOTIFICATION_FILTERS, "drafts", TODAY);
  assert.equal(isMetricCardSelected(drafts, "drafts", TODAY), true);
  assert.equal(isMetricCardSelected({ ...drafts, from: TODAY, to: TODAY }, "drafts", TODAY), true);
  assert.equal(
    isMetricCardSelected({ ...EMPTY_NOTIFICATION_FILTERS, bucket: "sent" }, "sentToday", TODAY),
    false,
  );
  assert.equal(
    isMetricCardSelected(
      { ...EMPTY_NOTIFICATION_FILTERS, bucket: "sent", from: TODAY, to: TODAY },
      "sentToday",
      TODAY,
    ),
    true,
  );
});

test("the URL carries the selected card and its scope so the list can reload it", () => {
  const drafts = toggleMetricCard(EMPTY_NOTIFICATION_FILTERS, "drafts", TODAY);
  assert.equal(notificationFiltersToQuery(drafts), "?bucket=drafts");
  assert.deepEqual(parseNotificationFilters(new URLSearchParams("bucket=drafts")), drafts);

  const sentToday = toggleMetricCard(RANGED, "sentToday", TODAY);
  const query = new URLSearchParams(notificationFiltersToQuery(sentToday));
  assert.equal(query.get("bucket"), "sent");
  assert.equal(query.get("from"), TODAY);
  assert.equal(query.get("to"), TODAY);
  assert.deepEqual(parseNotificationFilters(query), sentToday);
});

test("sent buckets read the send timestamp, every other bucket the created one", () => {
  assert.equal(dateFieldForBucket("sent"), "sent_at");
  assert.equal(dateFieldForBucket("all"), "created_at");
  assert.equal(dateFieldForBucket("drafts"), "created_at");
  assert.equal(dateFieldForBucket("scheduled"), "created_at");
  assert.equal(dateFieldForBucket("failed"), "created_at");
});
