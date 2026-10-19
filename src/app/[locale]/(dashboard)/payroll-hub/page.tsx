import { setRequestLocale, getTranslations } from "next-intl/server";
import { BarChart3, Scale, Wallet } from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/require-permission";

/**
 * PayrollHub — the three money surfaces that left OperationsHub.
 *
 * Performance, Order reconciliation and Payroll used to sit on `/operations`
 * beside the rule tables, which made the payroll conversation start one page
 * away from Payroll itself. They live here now, gated exactly as before, so a
 * card is still never an advertisement for a page that answers /unauthorized.
 */
const HUB_PERMISSIONS = ["payroll.view", "performance.view", "order_recon.view"] as const;

const CARDS: ReadonlyArray<{
  key: string;
  href: string;
  icon: typeof Wallet;
  permission: Permission;
}> = [
  { key: "performance", href: "/performance", icon: BarChart3, permission: "performance.view" },
  {
    key: "orderReconciliation",
    href: "/deliveries/reconciliation",
    icon: Scale,
    permission: "order_recon.view",
  },
  { key: "payroll", href: "/payroll", icon: Wallet, permission: "payroll.view" },
];

export default async function PayrollHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireAnyPermission(locale, HUB_PERMISSIONS);
  const t = await getTranslations("pages.payrollHub.hub");

  const cards = CARDS.filter((card) =>
    hasPermissionInSet(session.permissions, card.permission, session.isSuperAdmin),
  );

  return (
    <AppPage className="space-y-4">
      <AppPageHeader
        breadcrumbs={[{ label: t("breadcrumb") }]}
        title={t("title")}
        description={t("subtitle")}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
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
