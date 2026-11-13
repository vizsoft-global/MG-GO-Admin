import { setRequestLocale, getTranslations } from "next-intl/server";
import {
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Handshake,
  Layers,
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
 * **Columns and slicers are configured on the table they change**, not here. The
 * client review (5.1 / 5.2) asked for them "directly in Operations Hub"; the
 * owner has since moved that decision to Rider Operations, where the operator can
 * see the column they are adding while they add it. This page now has one group:
 * the ledger tables.
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
  /**
   * The client catalog. The client review asks that a client added in Operations
   * Hub appears on the Employee Client field without further action, and this is
   * the one surface that can add one: the Employee Client dropdown is an open
   * list over `payroll_clients`, and its read is `staleTime: 0` with a refetch on
   * mount, so a row created here is in the dropdown on the next open.
   */
  {
    key: "clients",
    href: "/settings/payroll-clients",
    icon: UsersRound,
    tint: HUB_GLYPH_TINTS.rose,
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
