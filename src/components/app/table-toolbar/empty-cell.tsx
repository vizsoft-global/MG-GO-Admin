"use client";

import { useTranslations } from "next-intl";

export function EmptyCell({ editable = false }: { editable?: boolean }) {
  const t = useTranslations("common.tableToolbar");
  if (editable) {
    return <span className="text-sm text-[var(--text-muted)]">{t("select")}</span>;
  }
  return <span className="text-sm text-foreground">—</span>;
}
