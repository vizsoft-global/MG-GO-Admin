import { setRequestLocale, getTranslations } from "next-intl/server";
import {
  Building2,
  Car,
  ClipboardCheck,
  FormInput,
  Handshake,
  ListTree,
  MapPin,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/require-permission";
import { OPERATIONS_HUB_PERMISSIONS } from "@/lib/menu/menu-registry";

/**
 * OperationsHub — the home of the operational rule tables.
 *
 * This is a **settings section, not a guard of its own**: it opens for anyone
 * holding any one of `OPERATIONS_HUB_PERMISSIONS`, which is also what the
 * sidebar group is gated on, so the card list and the menu cannot disagree about
 * who may see it.
 *
 * Each card is filtered by **its own** permission and the target page is gated on
 * the same slug, so a card can never be an advertisement for a page that answers
 * /unauthorized. Nothing here is a promise of a route that does not exist —
 * every href below is a page that ships today.
 */
const CARDS: ReadonlyArray<{
  key: string;
  href: string;
  icon: typeof Handshake;
  permission: Permission;
}> = [
  { key: "partners", href: "/partners", icon: Handshake, permission: "partners.view" },
  { key: "restaurants", href: "/restaurants", icon: UtensilsCrossed, permission: "restaurants.view" },
  { key: "zones", href: "/zones", icon: MapPin, permission: "zones.view" },
  { key: "deliveryRules", href: "/delivery-rules", icon: ListTree, permission: "earnings.view" },
  { key: "incentiveRules", href: "/incentive-rules", icon: Wallet, permission: "earnings.view" },
  { key: "driverFields", href: "/settings/driver-fields", icon: FormInput, permission: "drivers.manage" },
  {
    key: "attendanceSettings",
    href: "/settings/attendance",
    icon: ClipboardCheck,
    permission: "attendance.manage",
  },
  { key: "vehicleTypes", href: "/settings/vehicle-types", icon: Car, permission: "vehicles.manage" },
  { key: "vehicleUses", href: "/settings/vehicle-uses", icon: Car, permission: "vehicles.manage" },
  {
    key: "sourceCompanies",
    href: "/settings/source-companies",
    icon: Building2,
    permission: "companies.view",
  },
];

export default async function OperationsHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireAnyPermission(locale, OPERATIONS_HUB_PERMISSIONS);
  const t = await getTranslations("pages.operationsHub.hub");

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
