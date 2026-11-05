import { setRequestLocale, getTranslations } from "next-intl/server";
import {
  Bike,
  BriefcaseBusiness,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FormInput,
  Globe,
  Handshake,
  Landmark,
  Layers,
  ListChecks,
  ListTree,
  MapPin,
  UsersRound,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { AppHubShell, HUB_GLYPH_TINTS, type HubGroup } from "@/components/app/app-hub-shell";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/require-permission";
import { OPERATIONS_HUB_PERMISSIONS } from "@/lib/menu/menu-registry";

/**
 * OperationsHub — the home of the operational rule tables, on the same Figma
 * shell as Visit bookings (`AppHubShell`).
 *
 * This is a **settings section, not a guard of its own**: it opens for anyone
 * holding any one of `OPERATIONS_HUB_PERMISSIONS`, which is also what the
 * sidebar group is gated on, so the tile list and the menu cannot disagree about
 * who may see it. Each tile is filtered by **its own** permission and the target
 * page is gated on the same slug, so a tile can never be an advertisement for a
 * page that answers /unauthorized.
 *
 * The two panels are the design's own split: the ledgers and their rules on the
 * start panel, the catalogs that feed them on the end panel.
 */
type OpsTile = {
  key: string;
  href: string;
  icon: typeof Handshake;
  tint: (typeof HUB_GLYPH_TINTS)[keyof typeof HUB_GLYPH_TINTS];
  permission: Permission;
};

const MANAGE_TILES: OpsTile[] = [
  { key: "partners", href: "/partners", icon: Handshake, tint: HUB_GLYPH_TINTS.teal, permission: "partners.view" },
  {
    key: "restaurants",
    href: "/restaurants",
    icon: UtensilsCrossed,
    tint: HUB_GLYPH_TINTS.rust,
    permission: "restaurants.view",
  },
  { key: "zones", href: "/zones", icon: MapPin, tint: HUB_GLYPH_TINTS.navy, permission: "zones.view" },
  {
    key: "driverGroups",
    href: "/drivers/groups",
    icon: UsersRound,
    tint: HUB_GLYPH_TINTS.rose,
    permission: "driver_groups.view",
  },
  {
    key: "attendance",
    href: "/attendance",
    icon: ClipboardCheck,
    tint: HUB_GLYPH_TINTS.olive,
    permission: "attendance.view",
  },
  {
    key: "roster",
    href: "/operations/roster",
    icon: CalendarClock,
    tint: HUB_GLYPH_TINTS.gold,
    permission: "attendance.view",
  },
  {
    key: "orderExceptions",
    href: "/order-exceptions",
    icon: ClipboardList,
    tint: HUB_GLYPH_TINTS.brown,
    permission: "deliveries.view",
  },
  {
    key: "deliveryRules",
    href: "/delivery-rules",
    icon: ListTree,
    tint: HUB_GLYPH_TINTS.teal,
    permission: "earnings.view",
  },
  {
    key: "incentiveRules",
    href: "/incentive-rules",
    icon: Wallet,
    tint: HUB_GLYPH_TINTS.gold,
    permission: "earnings.view",
  },
];

const CONFIGURE_TILES: OpsTile[] = [
  {
    key: "driverFields",
    href: "/settings/driver-fields",
    icon: FormInput,
    tint: HUB_GLYPH_TINTS.navy,
    permission: "drivers.manage",
  },
  {
    key: "serviceTypes",
    href: "/settings/service-types",
    icon: ListChecks,
    tint: HUB_GLYPH_TINTS.rose,
    permission: "service.manage",
  },
  {
    key: "attendanceSettings",
    href: "/settings/attendance",
    icon: ClipboardCheck,
    tint: HUB_GLYPH_TINTS.olive,
    permission: "attendance.manage",
  },
  {
    key: "vehicleTypes",
    href: "/settings/vehicle-types",
    icon: Bike,
    tint: HUB_GLYPH_TINTS.teal,
    permission: "vehicles.manage",
  },
  {
    key: "employeeStatuses",
    href: "/settings/employee-statuses",
    icon: ClipboardList,
    tint: HUB_GLYPH_TINTS.brown,
    permission: "drivers.manage",
  },
  {
    key: "employeeSections",
    href: "/settings/employee-sections",
    icon: Layers,
    tint: HUB_GLYPH_TINTS.navy,
    permission: "drivers.manage",
  },
  {
    key: "nationalityCategories",
    href: "/settings/nationality-categories",
    icon: Globe,
    tint: HUB_GLYPH_TINTS.rust,
    permission: "drivers.manage",
  },
  {
    key: "bankCodes",
    href: "/settings/bank-codes",
    icon: Landmark,
    tint: HUB_GLYPH_TINTS.rose,
    permission: "drivers.manage",
  },
  {
    key: "jobPositions",
    href: "/settings/job-positions",
    icon: BriefcaseBusiness,
    tint: HUB_GLYPH_TINTS.teal,
    permission: "drivers.manage",
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

  const visible = (tile: OpsTile): boolean =>
    hasPermissionInSet(session.permissions, tile.permission, session.isSuperAdmin);

  const toTile = (tile: OpsTile) => ({
    href: tile.href,
    label: t(`cards.${tile.key}.title`),
    icon: tile.icon,
    tint: tile.tint,
  });

  const groups: HubGroup[] = [
    {
      id: "manage",
      heading: t("manageHeading"),
      hint: t("manageHint"),
      tiles: MANAGE_TILES.filter(visible).map(toTile),
    },
    {
      id: "configure",
      heading: t("configureHeading"),
      hint: t("configureHint"),
      tiles: CONFIGURE_TILES.filter(visible).map(toTile),
    },
  ].filter((group) => group.tiles.length > 0);

  return (
    <AppHubShell
      title={t("title")}
      subtitle={t("subtitle")}
      breadcrumbHome={t("breadcrumbHome")}
      titleTile={{ icon: Layers, tint: HUB_GLYPH_TINTS.navy }}
      groups={groups}
    />
  );
}
