import { parseListBucket, type NotificationListBucket } from "./notification-list-buckets";
import type { NotificationDashboardScope, NotificationListFilters } from "./types";

/** Every list control on the notifications page lives in one URL-backed state object so a
 *  metric card click can never leave a stale date range behind that hides the rows it just
 *  counted. */
export type NotificationFilterState = {
  bucket: NotificationListBucket;
  category: string;
  from: string;
  to: string;
  createdBy: string;
};

export const EMPTY_NOTIFICATION_FILTERS: NotificationFilterState = {
  bucket: "all",
  category: "all",
  from: "",
  to: "",
  createdBy: "all",
};

export type NotificationMetricCard = "sentToday" | "scheduled" | "drafts" | "failed";

type SearchParamsLike = { get: (key: string) => string | null };

export function parseNotificationFilters(params: SearchParamsLike): NotificationFilterState {
  return {
    bucket: parseListBucket(params.get("bucket")),
    category: params.get("category") ?? "all",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    createdBy: params.get("createdBy") ?? "all",
  };
}

export function notificationFiltersToSearchParams(
  state: NotificationFilterState,
): URLSearchParams {
  const params = new URLSearchParams();
  if (state.bucket !== "all") params.set("bucket", state.bucket);
  if (state.category !== "all") params.set("category", state.category);
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.createdBy !== "all") params.set("createdBy", state.createdBy);
  return params;
}

export function notificationFiltersToQuery(state: NotificationFilterState): string {
  const query = notificationFiltersToSearchParams(state).toString();
  return query ? `?${query}` : "";
}

/**
 * The filter snapshot a metric card stands for. "Sent today" is the one card whose metric is
 * scoped to a day, so it carries that day and replaces any other period. Every other card only
 * swaps the bucket and keeps the rest of the scope, so the number on the card is exactly the
 * number of rows the grid renders after it is clicked.
 */
export function metricCardScope(
  state: NotificationFilterState,
  card: NotificationMetricCard,
  today: string,
): NotificationFilterState {
  switch (card) {
    case "sentToday":
      return { ...state, bucket: "sent", from: today, to: today };
    case "scheduled":
      return { ...state, bucket: "scheduled" };
    case "drafts":
      return { ...state, bucket: "drafts" };
    case "failed":
      return { ...state, bucket: "failed" };
    default: {
      const unreachable: never = card;
      return unreachable;
    }
  }
}

export function isMetricCardSelected(
  state: NotificationFilterState,
  card: NotificationMetricCard,
  today: string,
): boolean {
  const scope = metricCardScope(state, card, today);
  return state.bucket === scope.bucket && state.from === scope.from && state.to === scope.to;
}

/** Toggles a metric card: clicking the active card drops its bucket, and "Sent today" also
 *  drops the day range it pinned. */
export function toggleMetricCard(
  state: NotificationFilterState,
  card: NotificationMetricCard,
  today: string,
): NotificationFilterState {
  if (isMetricCardSelected(state, card, today)) {
    return card === "sentToday"
      ? { ...state, bucket: "all", from: "", to: "" }
      : { ...state, bucket: "all" };
  }
  return metricCardScope(state, card, today);
}

/** The list reads "sent" rows by their send time; every other bucket is a created-at list. */
export function dateFieldForBucket(bucket: NotificationListBucket): "created_at" | "sent_at" {
  return bucket === "sent" ? "sent_at" : "created_at";
}

/** The one place page state becomes the grid's server filters. */
export function listFiltersForState(
  state: NotificationFilterState,
  search = "",
): NotificationListFilters {
  const filters: NotificationListFilters = { dateField: dateFieldForBucket(state.bucket) };
  if (state.bucket !== "all") filters.bucket = state.bucket;
  if (state.category !== "all") filters.category = state.category;
  if (state.from) filters.fromDate = state.from;
  if (state.to) filters.toDate = state.to;
  if (state.createdBy !== "all") filters.createdBy = state.createdBy;
  if (search) filters.search = search;
  return filters;
}

/** ...and the one place it becomes the metric cards' server scope, so the same filters that
 *  shrink the grid also shrink every card above it. */
export function dashboardScopeForState(
  state: NotificationFilterState,
  search = "",
): NotificationDashboardScope {
  const scope: NotificationDashboardScope = {};
  if (state.category !== "all") scope.category = state.category;
  if (state.createdBy !== "all") scope.createdBy = state.createdBy;
  if (state.from) scope.fromDate = state.from;
  if (state.to) scope.toDate = state.to;
  if (search) scope.search = search;
  return scope;
}
