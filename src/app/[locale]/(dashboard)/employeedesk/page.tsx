import { setRequestLocale, getTranslations } from "next-intl/server";
import { FileSignature, FolderTree, Inbox, LineChart, Settings2 } from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { requireAnyPermission } from "@/lib/auth/require-permission";

/**
 * EmployeeDesk hub — the entry point of the additive V2 tree.
 *
 * Every card points at a route that exists today. The tree deepens in place as
 * each V2 screen ships, so nothing here is a promise of a page that 404s; a
 * "Coming soon" tile would be worse than no tile, because it advertises work
 * rather than describing what the operator can do now.
 */
const CARDS = [
  { key: "esign", href: "/employeedesk/esign", icon: FileSignature },
  { key: "requests", href: "/requests/overview", icon: Inbox },
  { key: "visits", href: "/visit-bookings", icon: FolderTree },
  { key: "reports", href: "/employeedesk/reports", icon: LineChart },
  { key: "settings", href: "/requests/settings", icon: Settings2 },
] as const;

export default async function EmployeeDeskHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.view", "requests.view"]);
  const t = await getTranslations("pages.employeedesk.hub");

  return (
    <AppPage className="space-y-4">
      <AppPageHeader
        breadcrumbs={[{ label: t("breadcrumb") }]}
        title={t("title")}
        description={t("subtitle")}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.key} href={card.href} className="group">
              <Card className="h-full rounded-xl border-border bg-card shadow-sm transition-colors group-hover:border-primary/40">
                <CardContent className="flex items-start gap-3 p-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {t(`cards.${card.key}.title`)}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {t(`cards.${card.key}.body`)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </AppPage>
  );
}
