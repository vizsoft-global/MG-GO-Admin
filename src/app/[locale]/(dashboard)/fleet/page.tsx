import { setRequestLocale, getTranslations } from "next-intl/server";
import {
  AlertTriangle,
  ArrowLeftRight,
  Building2,
  Car,
  FileX,
  Fuel,
  ListChecks,
  Package,
  Tags,
  Waypoints,
  Wrench,
} from "lucide-react";
import { AppHubShell, HUB_GLYPH_TINTS, type HubGroup } from "@/components/app/app-hub-shell";
import {
  hasAnyPermissionInSet,
  hasPermissionInSet,
  type Permission,
} from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/require-permission";

/**
 * Fleet Hub — the same Figma shell as Visit bookings (`AppHubShell`).
 *
 * The design's two-panel split maps straight onto this hub: the fleet you run
 * day to day on the start panel, the catalogs that shape it on the end panel.
 * Each tile is filtered by **its own** permission, so a tile is never an
 * advertisement for a page that answers /unauthorized.
 */
const FLEET_HUB_PERMISSIONS = [
  "vehicles.view",
  "vehicles.manage",
  "fuel.view",
  "fuel_requests.view",
  "fuel_refunds.view",
  "assets.view",
  "asset_requests.view",
  "service.view",
  "service.manage",
] as const satisfies readonly Permission[];

type FleetTile = {
  key: string;
  href: string;
  icon: typeof Car;
  tint: (typeof HUB_GLYPH_TINTS)[keyof typeof HUB_GLYPH_TINTS];
  permission?: Permission;
  requireAny?: readonly Permission[];
};

const MANAGE_TILES: FleetTile[] = [
  { key: "vehicles", href: "/vehicles", icon: Car, tint: HUB_GLYPH_TINTS.teal, permission: "vehicles.view" },
  {
    key: "fuel",
    href: "/fuel",
    icon: Fuel,
    tint: HUB_GLYPH_TINTS.gold,
    requireAny: ["fuel.view", "fuel_requests.view", "fuel_refunds.view"],
  },
  {
    key: "assets",
    href: "/assets",
    icon: Package,
    tint: HUB_GLYPH_TINTS.olive,
    requireAny: ["assets.view", "asset_requests.view"],
  },
  {
    key: "service",
    href: "/fleet/service",
    icon: Wrench,
    tint: HUB_GLYPH_TINTS.rose,
    permission: "service.view",
  },
  {
    key: "handover",
    href: "/fleet/handover",
    icon: ArrowLeftRight,
    tint: HUB_GLYPH_TINTS.navy,
    permission: "vehicles.view",
  },
  {
    key: "accident",
    href: "/fleet/accident",
    icon: AlertTriangle,
    tint: HUB_GLYPH_TINTS.rust,
    permission: "vehicles.view",
  },
  {
    key: "rj",
    href: "/fleet/rj",
    icon: FileX,
    tint: HUB_GLYPH_TINTS.brown,
    requireAny: ["fuel.view", "fuel_requests.view", "fuel_refunds.view", "asset_requests.view"],
  },
];

const CONFIGURE_TILES: FleetTile[] = [
  {
    key: "vehicleTypes",
    href: "/settings/vehicle-types",
    icon: Tags,
    tint: HUB_GLYPH_TINTS.teal,
    permission: "vehicles.manage",
  },
  {
    key: "serviceTypes",
    href: "/settings/service-types",
    icon: ListChecks,
    tint: HUB_GLYPH_TINTS.rose,
    permission: "service.manage",
  },
  {
    key: "vehicleUses",
    href: "/settings/vehicle-uses",
    icon: Waypoints,
    tint: HUB_GLYPH_TINTS.olive,
    permission: "vehicles.manage",
  },
  {
    key: "vehicleCompanies",
    href: "/settings/vehicle-companies",
    icon: Building2,
    tint: HUB_GLYPH_TINTS.navy,
    permission: "vehicles.manage",
  },
];

function visible(
  tile: FleetTile,
  permissions: ReadonlySet<string>,
  isSuperAdmin: boolean,
): boolean {
  if (tile.requireAny) return hasAnyPermissionInSet(permissions, tile.requireAny, isSuperAdmin);
  if (!tile.permission) return false;
  return hasPermissionInSet(permissions, tile.permission, isSuperAdmin);
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

  const groups: HubGroup[] = [
    {
      id: "manage",
      heading: t("manageHeading"),
      hint: t("manageHint"),
      tiles: MANAGE_TILES.filter((tile) =>
        visible(tile, session.permissions, session.isSuperAdmin),
      ).map((tile) => ({
        href: tile.href,
        label: t(`cards.${tile.key}.title`),
        icon: tile.icon,
        tint: tile.tint,
      })),
    },
    {
      id: "configure",
      heading: t("configureHeading"),
      hint: t("configureHint"),
      tiles: CONFIGURE_TILES.filter((tile) =>
        visible(tile, session.permissions, session.isSuperAdmin),
      ).map((tile) => ({
        href: tile.href,
        label: t(`cards.${tile.key}.title`),
        icon: tile.icon,
        tint: tile.tint,
      })),
    },
  ].filter((group) => group.tiles.length > 0);

  return (
    <AppHubShell
      title={t("title")}
      subtitle={t("subtitle")}
      breadcrumbHome={t("breadcrumbHome")}
      titleTile={{ icon: Car, tint: HUB_GLYPH_TINTS.teal }}
      groups={groups}
    />
  );
}
