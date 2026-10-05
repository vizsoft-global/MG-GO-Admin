"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  ChevronRight,
  ClipboardList,
  Clock,
  FileSignature,
  History,
  Loader2,
  ShieldCheck,
  Timer,
  type LucideIcon,
} from "lucide-react";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  AppListCard,
  AppPage,
  AppPageHeader,
  TableCell,
} from "@/components/app";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { Link } from "@/i18n/navigation";
import { usePermissions } from "@/hooks/use-permissions";
import { queryKeys } from "@/lib/query/query-keys";
import { useEsignStatusCounts } from "@/features/esign/use-esign";
import { datePresetToBounds } from "@/features/requests/date-presets";
import { useAdminRequestsList } from "@/features/requests/use-requests";
import { fetchRequestDepartmentReport } from "@/features/requests/requests-settings-actions";
import { fetchAdminVisitsList } from "@/features/visits/visits-actions";

/**
 * EmployeeDesk → Reports (also mounted at `/requests/reports`, whose tile on
 * the Requests hub used to open a stub — `origin` only changes the breadcrumb
 * root, so there is one implementation and no second report to disagree with).
 *
 * A cross-module hub, not a fourth report. Requests, visits and the audit trail
 * each already own a real report page with its own controls, CSV and XLSX, and
 * re-implementing any of them here would create a second screen that can
 * disagree with the first. What the hub adds is the one thing none of those
 * pages can state: the modules side by side, on **one stated window** (this
 * Kuwait month, the same bounds the KPI strip and the workload table both
 * read), so an operator can see that a quiet request queue is a busy signature
 * queue without opening three tabs.
 *
 * Two reads are gated by the *caller's* permissions rather than by this page:
 * the department workload table is a `requests.manage` read and the visits KPI
 * is a `visits.view` read, while both routes are reachable on `requests.view`
 * (which is what the menu registry grants the EmployeeDesk door). A refusal is
 * therefore an expected state, not a failure — each degrades to its own note or
 * to `—`, and no part of the page disappears for an operator who can only read.
 * The two cards whose destination is manager-gated say so rather than dropping a
 * viewer onto a permission page.
 */

type ReportLink = {
  href: string;
  key: string;
  icon: LucideIcon;
  /**
   * The destination gates itself on `requests.manage`. Declared here — `false`
   * included, so the union stays readable — because a card that silently drops
   * a viewer on a permission page is worse than a card that names the
   * requirement. Verified against each route's own `requirePermission`.
   */
  adminOnly: boolean;
};

const REPORT_LINKS = [
  {
    href: "/requests/settings/reports",
    key: "requests",
    icon: ClipboardList,
    adminOnly: true,
  },
  {
    href: "/visit-bookings/reports",
    key: "visits",
    icon: BarChart3,
    adminOnly: false,
  },
  {
    href: "/requests/settings/audit",
    key: "audit",
    icon: History,
    adminOnly: true,
  },
] as const satisfies readonly ReportLink[];

type ReportLinkKey = (typeof REPORT_LINKS)[number]["key"];

/** Which door the operator came through — the breadcrumb root, and nothing else. */
export type EmployeeDeskReportsOrigin = "employeedesk" | "requests";

function formatDays(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  return `${(seconds / 86400).toFixed(1)}d`;
}

export function EmployeeDeskReportsShell({
  origin = "employeedesk",
}: {
  origin?: EmployeeDeskReportsOrigin;
} = {}) {
  const t = useTranslations("pages.employeedesk.reports");
  const tRoot = useTranslations("pages.employeedesk.hub");
  const tRequests = useTranslations("pages.requests");
  const { can } = usePermissions();

  const canManageRequests = can("requests.manage");
  const canReadVisits = can("visits.view");

  /** One window for the whole page, stated once in the header subtitle. */
  const { from, to } = useMemo(() => datePresetToBounds("this_month"), []);

  const requests = useAdminRequestsList({
    datePreset: "this_month",
    limit: 1,
    offset: 0,
  });
  const esign = useEsignStatusCounts();

  const visits = useQuery({
    queryKey: queryKeys.visits.list({ scope: "reports-hub" }),
    queryFn: () => fetchAdminVisitsList({ limit: 1 }),
    enabled: canReadVisits,
    staleTime: 60_000,
  });

  const departments = useQuery({
    queryKey: queryKeys.requests.departmentReport(from, to),
    queryFn: () => fetchRequestDepartmentReport({ from, to }),
    enabled: canManageRequests,
    staleTime: 60_000,
  });

  /**
   * Both memos read one identity. `data?.rows ?? []` inline would allocate a
   * fresh array on every render while the query is pending, which is exactly
   * the shape that made an Add-modal effect re-fire forever elsewhere in this
   * panel — so the fallback lives inside the memo, not beside it.
   */
  const departmentRows = useMemo(() => departments.data?.rows ?? [], [departments.data]);
  const departmentMax = useMemo(
    () => departmentRows.reduce((max, row) => Math.max(max, row.requests), 0),
    [departmentRows],
  );

  const requestKpi = requests.data?.kpi;
  const visitKpi = visits.data?.kpi;

  const loading = requests.isLoading || esign.isLoading;

  /**
   * The breadcrumb root is the only thing `origin` decides. `/employeedesk` is
   * always a valid parent for this page; when the operator arrived from the
   * Requests hub the tile they clicked is on `/requests`, so going "up" to
   * EmployeeDesk would leave them one door away from where they started.
   */
  const breadcrumbRoot =
    origin === "requests"
      ? { label: tRequests("title"), href: "/requests" }
      : { label: tRoot("title"), href: "/employeedesk" };

  function linkMeta(key: ReportLinkKey): string | null {
    switch (key) {
      case "requests":
        return requestKpi ? t("meta.requests", { count: requestKpi.total }) : null;
      case "visits":
        return visitKpi ? t("meta.visits", { count: visitKpi.upcoming }) : null;
      case "audit":
        return null;
      default: {
        const _exhaustive: never = key;
        return _exhaustive;
      }
    }
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[breadcrumbRoot, { label: t("title") }]}
      />

      {loading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <KpiGrid
          compact
          items={[
            {
              label: t("kpi.requests"),
              value: requestKpi?.total ?? "—",
              icon: ClipboardList,
            },
            {
              label: t("kpi.pending"),
              value: requestKpi?.pending ?? "—",
              accent: "warning",
              icon: Clock,
            },
            {
              label: t("kpi.overdue"),
              value: requestKpi?.overdue ?? "—",
              accent: "danger",
              icon: AlertTriangle,
            },
            {
              label: t("kpi.esignPending"),
              value: esign.data?.pending ?? "—",
              accent: "warning",
              icon: FileSignature,
            },
            {
              /**
               * Carried over from the V1 `/requests/reports` page this hub
               * replaced — its "Avg. resolution" was the one number it showed
               * that the strip did not, and dropping it would have made the
               * repoint a small information loss on the same URL.
               */
              label: t("kpi.avgResolution"),
              value: formatDays(requestKpi?.avg_resolution_seconds),
              icon: Timer,
            },
            {
              label: t("kpi.visitsToday"),
              value: visitKpi?.today ?? "—",
              icon: BarChart3,
            },
          ]}
        />
      )}

      <section className="mt-2 space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("modulesHeading")}
        </h2>
        <div className="grid gap-2 lg:grid-cols-2">
          {REPORT_LINKS.map(({ href, key, icon: Icon, adminOnly }) => {
            const metaLabel = linkMeta(key);
            return (
              <Link
                key={href}
                href={href}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-semibold">{t(`links.${key}`)}</p>
                    {adminOnly ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        <ShieldCheck className="h-3 w-3" />
                        {t("adminOnly")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t(`linksDesc.${key}`)}
                  </p>
                  {metaLabel ? (
                    <p className="mt-1 text-[10px] text-muted-foreground/80">{metaLabel}</p>
                  ) : null}
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            );
          })}
        </div>
      </section>

      <AppListCard
        className="mt-2"
        title={t("workload.title")}
        description={t("workload.subtitle")}
        headerActions={
          canManageRequests ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              {t("workload.window")}
            </span>
          ) : null
        }
      >
        {!canManageRequests ? (
          <p className="border-t border-border px-4 py-8 text-center text-[11px] text-muted-foreground">
            {t("workload.managersOnly")}
          </p>
        ) : departments.isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <AppDataTable
            columns={[
              { id: "department", label: t("workload.columns.department") },
              { id: "requests", label: t("workload.columns.requests"), className: "text-end" },
              { id: "approved", label: t("workload.columns.approved"), className: "text-end" },
              { id: "rejected", label: t("workload.columns.rejected"), className: "text-end" },
              { id: "avgStep", label: t("workload.columns.avgStep"), className: "text-end" },
            ]}
            empty={
              departmentRows.length === 0 ? (
                <AppDataTableEmpty>
                  <p className="text-sm font-medium">
                    {departments.data?.error ? t("workload.failed") : t("workload.empty")}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {departments.data?.error ? t("workload.failedBody") : t("workload.emptyBody")}
                  </p>
                </AppDataTableEmpty>
              ) : undefined
            }
          >
            {departmentRows.map((row) => (
              <AppDataTableRow key={row.department_key}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{row.department_label}</span>
                    {departmentMax > 0 ? (
                      <span
                        className="h-1 rounded-full bg-primary/25"
                        style={{ width: `${Math.max(4, (row.requests / departmentMax) * 100)}%` }}
                        aria-hidden
                      />
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-end tabular-nums">{row.requests}</TableCell>
                <TableCell className="text-end tabular-nums">{row.approved}</TableCell>
                <TableCell className="text-end tabular-nums">{row.rejected}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatDays(row.avg_step_seconds)}
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>
    </AppPage>
  );
}
