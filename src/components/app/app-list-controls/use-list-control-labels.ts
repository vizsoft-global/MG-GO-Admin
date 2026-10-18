"use client";

import { useTranslations } from "next-intl";
import type { ListGroupByOption } from "./types";

export function useListControlLabels() {
  const t = useTranslations("common.listControls");
  return {
    searchBy: t("searchBy"),
    groupBy: t("groupBy"),
    viewTable: t("viewTable"),
    viewCards: t("viewCards"),
    clearSearch: t("clearSearch"),
    group: {
      none: { value: "none", label: t("groupNone") } satisfies ListGroupByOption,
      status: { value: "status", label: t("groupStatus") } satisfies ListGroupByOption,
      zone: { value: "zone", label: t("groupZone") } satisfies ListGroupByOption,
      partner: { value: "partner", label: t("groupPartner") } satisfies ListGroupByOption,
      date: { value: "date", label: t("groupDate") } satisfies ListGroupByOption,
      project: { value: "project", label: t("groupProject") } satisfies ListGroupByOption,
    },
  };
}
