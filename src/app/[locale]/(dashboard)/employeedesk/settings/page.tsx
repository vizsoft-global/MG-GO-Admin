import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowUpDown,
  ChevronRight,
  FileSignature,
  History,
  Package,
  ShieldCheck,
  Tags,
  Timer,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { requirePermission } from "@/lib/auth/require-permission";
import { AppPage, AppPageHeader } from "@/components/app";
import { Link } from "@/i18n/navigation";
import { fetchSettingsHubCounts } from "@/features/requests/requests-settings-actions";
import type { SettingsHubCounts } from "@/features/requests/settings-types";

/**
 * EmployeeDesk → Settings.
 *
 * Three presentational groups over the same twelve panels V1 already has —
 * no fork, every existing route stays reachable from here and from
 * `/requests/settings`. Grouping is the only thing this page adds, because a
 * flat list of twelve writers is a list an operator has to read twice.
 *
 * "Field builder" is deliberately **not** a row: it is the right pane of a
 * request type, and a link to the same list under a second name is exactly the
 * duplicate-destination problem the route aliases are built to avoid. The
 * Request types row says so in its description instead.
 *
 * A writer stays `requests.manage`; nothing here is widened. The counts come
 * from the same `fetchSettingsHubCounts` the V1 hub uses, so the two hubs cannot
 * quote different totals, and a failed count degrades to a link with no meta
 * rather than an error page.
 */

type SettingsLink = {
  href: string;
  key: string;
  icon: LucideIcon;
  /** Which group the row renders under. */
  group: "workflow" | "catalog" | "app";
};

const LINKS = [
  { href: "/requests/settings/workflows", key: "workflows", icon: Workflow, group: "workflow" },
  { href: "/requests/settings/types", key: "types", icon: Tags, group: "workflow" },
  { href: "/requests/settings/departments", key: "departments", icon: Users, group: "workflow" },
  { href: "/requests/settings/roles", key: "roles", icon: ShieldCheck, group: "workflow" },
  { href: "/requests/settings/categories", key: "categories", icon: Tags, group: "catalog" },
  { href: "/requests/settings/tenure", key: "tenure", icon: Timer, group: "catalog" },
  { href: "/requests/settings/assets", key: "assets", icon: Package, group: "catalog" },
  { href: "/requests/settings/screenshot", key: "screenshot", icon: ArrowUpDown, group: "catalog" },
  { href: "/requests/esign/settings", key: "esign", icon: FileSignature, group: "app" },
  { href: "/requests/import-export", key: "importExport", icon: ArrowUpDown, group: "app" },
  { href: "/requests/settings/audit", key: "audit", icon: History, group: "app" },
] as const satisfies readonly SettingsLink[];

const GROUPS = ["workflow", "catalog", "app"] as const;

type SettingsLinkKey = (typeof LINKS)[number]["key"];

export default async function EmployeeDeskSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");
  const t = await getTranslations("pages.employeedesk.settings");
  const tRoot = await getTranslations("pages.employeedesk.hub");

  let counts: SettingsHubCounts | null = null;
  try {
    counts = await fetchSettingsHubCounts();
  } catch {
    counts = null;
  }

  function meta(key: SettingsLinkKey): string | null {
    switch (key) {
      case "workflows":
        return counts ? t("linksMeta.workflows", { count: counts.workflows }) : null;
      case "types":
        return counts ? t("linksMeta.types", { count: counts.types }) : null;
      case "assets":
        return counts ? t("linksMeta.assets", { count: counts.assets }) : null;
      case "departments":
        return counts ? t("linksMeta.departments", { count: counts.departments }) : null;
      case "roles":
        return counts ? t("linksMeta.roles", { count: counts.roles }) : null;
      case "esign":
        return counts ? t("linksMeta.esign", { count: counts.esignCategories }) : null;
      case "categories":
      case "tenure":
      case "screenshot":
      case "importExport":
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
        breadcrumbs={[{ label: tRoot("title"), href: "/employeedesk" }, { label: t("title") }]}
      />
      <div className="space-y-3">
        {GROUPS.map((group) => (
          <section key={group} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`groups.${group}`)}
            </h2>
            <div className="grid gap-2 lg:grid-cols-2">
              {LINKS.filter((link) => link.group === group).map(({ href, key, icon: Icon }) => {
                const metaLabel = meta(key);
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
                      <p className="text-sm font-semibold">{t(`links.${key}`)}</p>
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
        ))}
      </div>
    </AppPage>
  );
}
