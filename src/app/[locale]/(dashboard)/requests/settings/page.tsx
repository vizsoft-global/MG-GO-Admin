import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { AppPage, AppPageHeader } from "@/components/app";
import { Link } from "@/i18n/navigation";

const LINKS = [
  { href: "/requests/settings/workflows", key: "workflows" },
  { href: "/requests/settings/categories", key: "categories" },
  { href: "/requests/settings/types", key: "types" },
  { href: "/requests/settings/departments", key: "departments" },
  { href: "/requests/settings/roles", key: "roles" },
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
              {t("comingSoon")}
            </p>
          </Link>
        ))}
      </div>
    </AppPage>
  );
}
