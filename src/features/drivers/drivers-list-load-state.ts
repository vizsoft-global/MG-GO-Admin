/**
 * What the drivers list should render after a request settles.
 *
 * The list is paginated with `useInfiniteQuery`, and `isError` goes true on
 * **any** failed request — including the background invalidate this page fires
 * every minute, and the refetch that runs when the operator comes back to a
 * screen they already loaded. In both of those `data` still holds the pages it
 * already has, so treating the error as "the list is empty" blanked a loaded
 * roster and left the toolbar printing its cached total: the table said
 * "No employees match your search" over 975 riders.
 *
 * The distinction this module draws is the one the screen needs: a failure with
 * nothing cached is a real failure and deserves its own retry; a failure with
 * pages still in hand is a refresh that did not land, and the rows stay on
 * screen with a strip saying so.
 */
export type DriversListLoadState = {
  /** Nothing to show: the empty state must be the error state, not a search miss. */
  hardFailed: boolean;
  /** Rows are on screen but the latest refresh did not land. */
  refreshFailed: boolean;
};

export function driversListLoadState(input: {
  isError: boolean;
  hasData: boolean;
}): DriversListLoadState {
  return {
    hardFailed: input.isError && !input.hasData,
    refreshFailed: input.isError && input.hasData,
  };
}

/**
 * Whether the "no employees match" copy may be shown.
 *
 * `tabTotal > 0` alone used to be enough, which is what let a failed request
 * render a search-miss message over a full roster. A tab total that is only
 * known because of a failed read is not evidence that a filter hid anything.
 */
export function driversListShowsEmptySearch(input: {
  loading: boolean;
  hardFailed: boolean;
  rowCount: number;
  hasNarrowing: boolean;
  tabTotal: number;
}): boolean {
  if (input.loading || input.hardFailed) return false;
  if (input.rowCount > 0) return false;
  return input.hasNarrowing || input.tabTotal > 0;
}
