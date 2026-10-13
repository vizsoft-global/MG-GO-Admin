import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowUpDown,
  Camera,
  ChevronRight,
  FileSignature,
  FileText,
  History,
  LayoutTemplate,
  Package,
  SlidersHorizontal,
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
 * Figma S0 (`5926:6246`) is exactly these 10 tiles, in this order.
 * Complaint categories and loan tenure stay on the type detail pages.
 * Counts come from `fetchSettingsHubCounts` so a tile quotes the live total.
 * A writer stays `requests.manage`.
 */

type SettingsLinkKey =
  | "workflows"
  | "types"
  | "assets"
  | "departments"
  | "audit"
  | "importExport"
  | "roles"
  | "screenshot"
  | "esign"
  | "templates";

type SettingsLink = {
  href: string;
  key: SettingsLinkKey;
  icon: LucideIcon;
};

const LINKS = [
  { href: "/requests/settings/workflows", key: "workflows", icon: Workflow },
  { href: "/requests/settings/types", key: "types", icon: FileText },
  { href: "/requests/settings/assets", key: "assets", icon: Package },
  { href: "/requests/settings/departments", key: "departments", icon: Users },
  { href: "/requests/settings/audit", key: "audit", icon: History },
  { href: "/requests/import-export", key: "importExport", icon: ArrowUpDown },
  { href: "/requests/settings/roles", key: "roles", icon: SlidersHorizontal },
  { href: "/requests/settings/screenshot", key: "screenshot", icon: Camera },
  { href: "/requests/esign/settings", key: "esign", icon: FileSignature },
  { href: "/employeedesk/esign/templates", key: "templates", icon: LayoutTemplate },
] as const satisfies readonly SettingsLink[];

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
  const tReqMeta = await getTranslations("pages.requests.settings.linksMeta");

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
      case "templates":
        return counts ? t("linksMeta.templates", { count: counts.templates }) : null;
      case "audit":
        return tReqMeta("audit");
      case "importExport":
        return tReqMeta("importExport");
      case "screenshot":
        return tReqMeta("screenshot");
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
      <div className="grid gap-4 lg:grid-cols-2">
        {LINKS.map(({ href, key, icon: Icon }) => {
          const metaLabel = meta(key);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-start gap-3 rounded-[10px] border border-[#E4E4E7] bg-card p-[18px] transition-colors duration-150 hover:bg-muted/40"
            >
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#F4F4F5] text-[#52525B]">
                <Icon className="size-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-[#18181B]">{t(`links.${key}`)}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-[#71717A]">
                  {t(`linksDesc.${key}`)}
                </p>
                {metaLabel ? (
                  <p className="mt-1 text-[11.5px] text-[#A1A1AA]">{metaLabel}</p>
                ) : null}
              </div>
              <ChevronRight className="mt-1 size-4 shrink-0 text-[#A1A1AA]" />
            </Link>
          );
        })}
      </div>
    </AppPage>
  );
}
