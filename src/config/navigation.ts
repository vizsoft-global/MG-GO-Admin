import type { Permission } from "@/lib/auth/permissions";

export type NavIcon =
  | "LayoutDashboard"
  | "Users"
  | "Truck"
  | "Package"
  | "MapPin"
  | "Bike"
  | "ClipboardCheck"
  | "Inbox"
  | "AlertTriangle"
  | "Wallet"
  | "Bell"
  | "LifeBuoy"
  | "Settings"
  | "Radar";

export type NavItem = {
  href: string;
  labelKey: string;
  icon: NavIcon;
  permission: Permission;
  footer?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    labelKey: "nav.dashboard",
    icon: "LayoutDashboard",
    permission: "dashboard.view",
  },
  {
    href: "/drivers",
    labelKey: "nav.drivers",
    icon: "Users",
    permission: "drivers.view",
  },
  {
    href: "/live-tracking",
    labelKey: "nav.liveTracking",
    icon: "Radar",
    permission: "drivers.view",
  },
  {
    href: "/deliveries",
    labelKey: "nav.deliveries",
    icon: "Package",
    permission: "deliveries.view",
  },
  {
    href: "/zones",
    labelKey: "nav.zones",
    icon: "MapPin",
    permission: "zones.view",
  },
  {
    href: "/vehicles",
    labelKey: "nav.vehicles",
    icon: "Bike",
    permission: "vehicles.view",
  },
  {
    href: "/attendance",
    labelKey: "nav.attendance",
    icon: "ClipboardCheck",
    permission: "attendance.view",
  },
  {
    href: "/driver-shifts",
    labelKey: "nav.driverShifts",
    icon: "ClipboardCheck",
    permission: "attendance.view",
  },
  {
    href: "/worktime",
    labelKey: "nav.worktime",
    icon: "ClipboardCheck",
    permission: "attendance.view",
  },
  {
    href: "/requests",
    labelKey: "nav.requests",
    icon: "Inbox",
    permission: "requests.view",
  },
  {
    href: "/wrong-actions",
    labelKey: "nav.wrongActions",
    icon: "AlertTriangle",
    permission: "wrong_actions.view",
  },
  {
    href: "/earnings",
    labelKey: "nav.earnings",
    icon: "Wallet",
    permission: "earnings.view",
  },
  {
    href: "/delivery-rules",
    labelKey: "nav.deliveryRules",
    icon: "Package",
    permission: "earnings.view",
  },
  {
    href: "/incentive-rules",
    labelKey: "nav.incentiveRules",
    icon: "Wallet",
    permission: "earnings.view",
  },
  {
    href: "/payouts",
    labelKey: "nav.payouts",
    icon: "Wallet",
    permission: "earnings.view",
  },
  {
    href: "/notifications",
    labelKey: "nav.notifications",
    icon: "Bell",
    permission: "notifications.view",
  },
  {
    href: "/support",
    labelKey: "nav.support",
    icon: "LifeBuoy",
    permission: "support.view",
  },
  {
    href: "/settings",
    labelKey: "nav.settings",
    icon: "Settings",
    permission: "settings.view",
    footer: true,
  },
];

export const MAIN_NAV_ITEMS = NAV_ITEMS.filter((item) => !item.footer);
export const FOOTER_NAV_ITEMS = NAV_ITEMS.filter((item) => item.footer);
