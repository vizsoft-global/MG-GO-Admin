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

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[{ label: t("title") }]}
      />
      <div className="grid gap-2 lg:grid-cols-2">
        {LINKS.map(({ href, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t(`links.${key}`)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t(`linksDesc.${key}`)}</p>
            </div>
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </AppPage>
  );
}
