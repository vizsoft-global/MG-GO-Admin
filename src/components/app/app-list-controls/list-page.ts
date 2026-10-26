export const LIST_PAGE_SIZE = 80;

export function pageCount(total: number, pageSize = LIST_PAGE_SIZE): number {
  if (total <= 0) return 1;
  return Math.ceil(total / pageSize);
}

export function clampPage(page: number, total: number, pageSize = LIST_PAGE_SIZE): number {
  const last = pageCount(total, pageSize) - 1;
  if (!Number.isFinite(page) || page < 0) return 0;
  return Math.min(Math.floor(page), last);
}

export function pageSlice<T>(rows: readonly T[], page: number, pageSize = LIST_PAGE_SIZE): T[] {
  const safe = clampPage(page, rows.length, pageSize);
  const start = safe * pageSize;
  return rows.slice(start, start + pageSize);
}

export function pageRange(
  page: number,
  total: number,
  pageSize = LIST_PAGE_SIZE,
): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const safe = clampPage(page, total, pageSize);
  const from = safe * pageSize + 1;
  return { from, to: Math.min(total, from + pageSize - 1) };
}

export type GroupSectionInput<T> = {
  key: string;
  label: string;
  rows: readonly T[];
};

export type BuiltSection<T> = {
  key: string;
  label: string;
  total: number;
  open: boolean;
  page: number;
  showHeader: boolean;
  showPager: boolean;
  visibleRows: T[];
};

export function buildGroupSections<T>(input: {
  groups: readonly GroupSectionInput<T>[];
  grouped: boolean;
  openKeys: ReadonlySet<string>;
  groupPage: Readonly<Record<string, number>>;
  flatPage: number;
  pageSize?: number;
}): {
  sections: BuiltSection<T>[];
  scopeRows: T[];
  flatPager: { page: number; total: number } | null;
} {
  const pageSize = input.pageSize ?? LIST_PAGE_SIZE;
  if (!input.grouped) {
    const rows = input.groups.flatMap((group) => [...group.rows]);
    const page = clampPage(input.flatPage, rows.length, pageSize);
    return {
      sections: [
        {
          key: "all",
          label: "",
          total: rows.length,
          open: true,
          page,
          showHeader: false,
          showPager: false,
          visibleRows: pageSlice(rows, page, pageSize),
        },
      ],
      scopeRows: rows,
      flatPager: rows.length > pageSize ? { page, total: rows.length } : null,
    };
  }

  const sections: BuiltSection<T>[] = [];
  const scopeRows: T[] = [];
  for (const group of input.groups) {
    const open = input.openKeys.has(group.key);
    const page = clampPage(input.groupPage[group.key] ?? 0, group.rows.length, pageSize);
    if (open) scopeRows.push(...group.rows);
    sections.push({
      key: group.key,
      label: group.label,
      total: group.rows.length,
      open,
      page,
      showHeader: true,
      showPager: open && group.rows.length > pageSize,
      visibleRows: open ? pageSlice(group.rows, page, pageSize) : [],
    });
  }
  return { sections, scopeRows, flatPager: null };
}

export function scopeSelectionState(
  selected: ReadonlySet<string>,
  scopeIds: readonly string[],
): "all" | "some" | "none" {
  if (scopeIds.length === 0) return "none";
  let hits = 0;
  for (const id of scopeIds) {
    if (selected.has(id)) hits += 1;
  }
  if (hits === 0) return "none";
  if (hits === scopeIds.length) return "all";
  return "some";
}

export function toggleScopeSelection(
  selected: ReadonlySet<string>,
  scopeIds: readonly string[],
): Set<string> {
  const next = new Set(selected);
  const allOn = scopeIds.length > 0 && scopeIds.every((id) => next.has(id));
  for (const id of scopeIds) {
    if (allOn) next.delete(id);
    else next.add(id);
  }
  return next;
}
