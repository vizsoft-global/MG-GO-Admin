import { setRequestLocale, getTranslations } from "next-intl/server";
import {
  AlertTriangle,
  ArrowLeftRight,
  Building2,
  Car,
  FileX,
  Fuel,
  Package,
  Tags,
  Waypoints,
  Wrench,
} from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import {
  hasAnyPermissionInSet,
  hasPermissionInSet,
  type Permission,
} from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/require-permission";

const FLEET_HUB_PERMISSIONS = [
  "vehicles.view",
  "vehicles.manage",
  "fuel.view",
  "fuel_requests.view",
  "fuel_refunds.view",
  "assets.view",
  "asset_requests.view",
] as const satisfies readonly Permission[];

const CARDS: ReadonlyArray<{
  key: string;
  href: string;
  icon: typeof Car;
  permission?: Permission;
  requireAny?: readonly Permission[];
}> = [
  { key: "vehicles", href: "/vehicles", icon: Car, permission: "vehicles.view" },
  {
    key: "fuel",
    href: "/fuel",
    icon: Fuel,
    requireAny: ["fuel.view", "fuel_requests.view", "fuel_refunds.view"],
  },
  {
    key: "assets",
    href: "/assets",
    icon: Package,
    requireAny: ["assets.view", "asset_requests.view"],
  },
  { key: "service", href: "/fleet/service", icon: Wrench, permission: "vehicles.view" },
  { key: "handover", href: "/fleet/handover", icon: ArrowLeftRight, permission: "vehicles.view" },
  { key: "accident", href: "/fleet/accident", icon: AlertTriangle, permission: "vehicles.view" },
  {
    key: "rj",
    href: "/fleet/rj",
    icon: FileX,
    requireAny: ["fuel.view", "fuel_requests.view", "fuel_refunds.view", "asset_requests.view"],
  },
  { key: "vehicleTypes", href: "/settings/vehicle-types", icon: Tags, permission: "vehicles.manage" },
  { key: "vehicleUses", href: "/settings/vehicle-uses", icon: Waypoints, permission: "vehicles.manage" },
  {
    key: "vehicleCompanies",
    href: "/settings/vehicle-companies",
    icon: Building2,
    permission: "vehicles.manage",
  },
];

function cardVisible(
  card: (typeof CARDS)[number],
  permissions: ReadonlySet<string>,
  isSuperAdmin: boolean,
): boolean {
  if (card.requireAny) {
    return hasAnyPermissionInSet(permissions, card.requireAny, isSuperAdmin);
  }
  if (!card.permission) return false;
  return hasPermissionInSet(permissions, card.permission, isSuperAdmin);
}

export default async function FleetHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireAnyPermission(locale, FLEET_HUB_PERMISSIONS);
  const t = await getTranslations("pages.fleetHub.hub");

  const cards = CARDS.filter((card) =>
    cardVisible(card, session.permissions, session.isSuperAdmin),
  );

  return (
    <AppPage className="space-y-4">
      {/* The H1 is already "Fleet Hub" — a same-named breadcrumb above it was
          the duplicate the panel reported. */}
      <AppPageHeader title={t("title")} description={t("subtitle")} />

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
