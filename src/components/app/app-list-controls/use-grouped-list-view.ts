"use client";

import { useCallback, useMemo, useState } from "react";
import {
  LIST_PAGE_SIZE,
  buildGroupSections,
  type BuiltSection,
  type GroupSectionInput,
} from "./list-page";

export function useGroupedListView<T>(
  groups: readonly GroupSectionInput<T>[],
  grouped: boolean,
  resetKey = "",
  flatTotal?: number,
) {
  const groupKeySig = `${grouped ? "g" : "f"}\u0001${resetKey}\u0001${groups.map((group) => group.key).join("\u0001")}`;
  const [sig, setSig] = useState(groupKeySig);
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [groupPage, setGroupPage] = useState<Readonly<Record<string, number>>>({});
  const [flatPage, setFlatPage] = useState(0);

  if (sig !== groupKeySig) {
    setSig(groupKeySig);
    setOpenKeys(new Set());
    setGroupPage({});
    setFlatPage(0);
  }

  const built = useMemo(
    () =>
      buildGroupSections({
        groups,
        grouped,
        openKeys,
        groupPage,
        flatPage,
        totalOverride: flatTotal,
      }),
    [flatPage, flatTotal, groupPage, grouped, groups, openKeys],
  );

  const toggle = useCallback((key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const step = useCallback((key: string, dir: number) => {
    setGroupPage((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + dir }));
  }, []);

  /**
   * The pager may now count more rows than are loaded, so its last page is
   * derived from the reported total rather than from `sections`. Stepping is
   * clamped to it, or overshooting the end and stepping back would look stuck:
   * the stored page would still be past the last one when it came back.
   */
  const lastFlatPage = built.flatPager
    ? Math.max(0, Math.ceil(built.flatPager.total / LIST_PAGE_SIZE) - 1)
    : 0;

  const stepFlat = useCallback(
    (dir: number) => {
      setFlatPage((prev) => Math.min(Math.max(0, prev + dir), lastFlatPage));
    },
    [lastFlatPage],
  );

  return {
    sections: built.sections as BuiltSection<T>[],
    scopeRows: built.scopeRows,
    flatPager: built.flatPager,
    toggle,
    step,
    stepFlat,
  };
}
