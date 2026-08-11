import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { AppPage, AppPageHeader } from "@/components/app";
import { Link } from "@/i18n/navigation";

const LINKS = [
  { href: "/requests/esign", key: "esign", status: "ready" },
  { href: "/requests/settings/workflows", key: "workflows", status: "ready" },
  { href: "/requests/settings/categories", key: "categories", status: "ready" },
  { href: "/requests/settings/types", key: "types", status: "ready" },
  { href: "/requests/settings/departments", key: "departments", status: "ready" },
  { href: "/requests/settings/roles", key: "roles", status: "ready" },
  { href: "/requests/settings/screenshot", key: "screenshot", status: "ready" },
  { href: "/requests/settings/assets", key: "assets", status: "ready" },
  { href: "/requests/settings/reports", key: "reports", status: "stub" },
  { href: "/requests/settings/audit", key: "audit", status: "ready" },
] as const;

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
      <AppPageHeader title={t("title")} description={t("subtitle")} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-xl border border-border bg-card p-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted/40"
          >
            {t(`links.${link.key}`)}
            <p className="mt-1 text-[11px] font-normal text-muted-foreground">
              {link.status === "stub" ? t("stubNote") : t(`linksDesc.${link.key}`)}
            </p>
          </Link>
        ))}
      </div>
    </AppPage>
  );
}
