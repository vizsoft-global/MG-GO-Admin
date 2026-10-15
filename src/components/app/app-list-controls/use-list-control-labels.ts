"use client";

import { useTranslations } from "next-intl";
import type { ListGroupByOption, ListSearchFieldOption } from "./types";

export function useListControlLabels() {
  const t = useTranslations("common.listControls");
  return {
    searchBy: t("searchBy"),
    groupBy: t("groupBy"),
    viewTable: t("viewTable"),
    viewCards: t("viewCards"),
    clearSearch: t("clearSearch"),
    field: {
      all: { value: "all", label: t("searchFieldAll") } satisfies ListSearchFieldOption,
      name: { value: "name", label: t("searchFieldName") } satisfies ListSearchFieldOption,
      employee_id: { value: "employee_id", label: t("searchFieldEmployeeId") } satisfies ListSearchFieldOption,
      zone: { value: "zone", label: t("searchFieldZone") } satisfies ListSearchFieldOption,
      passport: { value: "passport", label: t("searchFieldPassport") } satisfies ListSearchFieldOption,
      civil_id: { value: "civil_id", label: t("searchFieldCivilId") } satisfies ListSearchFieldOption,
      order_id: { value: "order_id", label: t("searchFieldOrderId") } satisfies ListSearchFieldOption,
      plate: { value: "plate", label: t("searchFieldPlate") } satisfies ListSearchFieldOption,
      status: { value: "status", label: t("searchFieldStatus") } satisfies ListSearchFieldOption,
    },
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
