import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EmployeeDeskReportsShell } from "@/features/employeedesk/employeedesk-reports-shell";

/**
 * `/requests/reports` — the same cross-module report hub as
 * `/employeedesk/reports`, mounted on the URL the Requests hub has always
 * linked to.
 *
 * It replaces a page that called itself a stub in its own copy ("Detailed
 * analytics coming soon", "Use Settings → Reports for the RCM stub") and whose
 * **Full reports** button already pointed at the same
 * `/requests/settings/reports` this hub links. Its four KPIs were a strict
 * subset of the five above and two of them were labelled identically, so
 * swapping the body in is a superset on the same URL rather than a second
 * report that can disagree with the first.
 *
 * The gate is unchanged (`requests.view`), so no operator gains or loses
 * access: a viewer still reaches the page, the manager-only reads inside it
 * degrade in place, and the two cards whose destination needs
 * `requests.manage` say so instead of bouncing them to a permission wall.
 * `origin` only moves the breadcrumb root back to the Requests hub, which is
 * the tile they actually clicked.
 */
export default async function RequestsReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");

  return <EmployeeDeskReportsShell origin="requests" />;
}
