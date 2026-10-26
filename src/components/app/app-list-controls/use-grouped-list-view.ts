"use client";

import { useCallback, useMemo, useState } from "react";
import {
  buildGroupSections,
  type BuiltSection,
  type GroupSectionInput,
} from "./list-page";

export function useGroupedListView<T>(
  groups: readonly GroupSectionInput<T>[],
  grouped: boolean,
  resetKey = "",
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
      }),
    [flatPage, groupPage, grouped, groups, openKeys],
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

  const stepFlat = useCallback((dir: number) => {
    setFlatPage((prev) => prev + dir);
  }, []);

  return {
    sections: built.sections as BuiltSection<T>[],
    scopeRows: built.scopeRows,
    flatPager: built.flatPager,
    toggle,
    step,
    stepFlat,
  };
}
