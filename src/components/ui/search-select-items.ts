export type SearchSelectListItem = {
  value: string;
  label: string;
  hint?: string;
  keywords?: string[];
};

const DEFAULT_PINNED = ["all"];

export function buildSearchSelectVisibleItems<T extends SearchSelectListItem>({
  items,
  query,
  filteredItems,
  recents,
  recentsCount,
  defaultLimit,
  pinnedValues = DEFAULT_PINNED,
}: {
  items: T[];
  query: string;
  filteredItems: T[];
  recents: string[];
  recentsCount: number;
  defaultLimit: number;
  pinnedValues?: string[];
}): T[] {
  if (query.trim()) return filteredItems;

  const pinnedIds = new Set(pinnedValues);
  const pinned = items.filter((item) => pinnedIds.has(item.value));
  const byId = new Map(items.map((item) => [item.value, item]));
  const recentItems = recents
    .map((id) => byId.get(id))
    .filter((item): item is T => item != null && !pinnedIds.has(item.value))
    .slice(0, recentsCount);
  const recentIds = new Set(recentItems.map((item) => item.value));
  const remaining = items
    .filter((item) => !pinnedIds.has(item.value) && !recentIds.has(item.value))
    .slice(0, Math.max(defaultLimit - pinned.length - recentItems.length, 0));
  return [...pinned, ...recentItems, ...remaining];
}
