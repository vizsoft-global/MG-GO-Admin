"use client";

import { useTranslations } from "next-intl";
import type { AppBreadcrumbItem } from "@/components/app";

/**
 * `{Fleet Hub → /fleet}` prepended to a page's own crumb (QA #16).
 *
 * Every Fleet sub-page hangs off `/fleet`, but only the RJ page carried the
 * parent, so Vehicles, Fuel, Assets and the request queues read as orphans with
 * no way back to the hub. One hook keeps the parent's label and href in a single
 * place instead of seven copies that drift.
 */
export function useFleetBreadcrumbs(): (
  page: AppBreadcrumbItem,
) => AppBreadcrumbItem[] {
  const tHub = useTranslations("pages.fleetHub.hub");
  return (page) => [{ label: tHub("breadcrumb"), href: "/fleet" }, page];
}
