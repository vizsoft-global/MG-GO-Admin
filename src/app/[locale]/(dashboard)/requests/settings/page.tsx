import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowUpDown,
  ChevronRight,
  FileSignature,
  History,
  Package,
  ShieldCheck,
  Tags,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { requirePermission } from "@/lib/auth/require-permission";
import { AppPage, AppPageHeader } from "@/components/app";
import { Link } from "@/i18n/navigation";
import { fetchSettingsHubCounts } from "@/features/requests/requests-settings-actions";
import type { SettingsHubCounts } from "@/features/requests/settings-types";

const LINKS: { href: string; key: string; icon: LucideIcon }[] = [
  { href: "/requests/settings/workflows", key: "workflows", icon: Workflow },
  { href: "/requests/settings/types", key: "types", icon: Tags },
  { href: "/requests/settings/assets", key: "assets", icon: Package },
  { href: "/requests/settings/departments", key: "departments", icon: Users },
  { href: "/requests/settings/audit", key: "audit", icon: History },
  { href: "/requests/import-export", key: "importExport", icon: ArrowUpDown },
  { href: "/requests/settings/roles", key: "roles", icon: ShieldCheck },
  { href: "/requests/settings/screenshot", key: "screenshot", icon: ArrowUpDown },
  { href: "/requests/esign/categories", key: "esign", icon: FileSignature },
];

export default async function RequestsSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");
  const t = await getTranslations("pages.requests.settings");
  const tRoot = await getTranslations("pages.requests");

  let counts: SettingsHubCounts | null = null;
  try {
    counts = await fetchSettingsHubCounts();
  } catch {
    counts = null;
  }

  function meta(key: string): string | null {
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
      case "audit":
        return t("linksMeta.audit");
      case "importExport":
        return t("linksMeta.importExport");
      case "screenshot":
        return t("linksMeta.screenshot");
      default:
        return null;
    }
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tRoot("title"), href: "/requests" },
          { label: t("title") },
        ]}
      />
      <div className="grid gap-2 lg:grid-cols-2">
        {LINKS.map(({ href, key, icon: Icon }) => {
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
                <p className="mt-0.5 text-[11px] text-muted-foreground">{t(`linksDesc.${key}`)}</p>
                {metaLabel ? (
                  <p className="mt-1 text-[10px] text-muted-foreground/80">{metaLabel}</p>
                ) : null}
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </AppPage>
  );
}
