import type { Permission } from "@/lib/auth/permissions";

export const APP_IDS = [
  "visits",
  "employeedesk",
  "fleet",
  "operations",
  "payroll",
  "live",
  "settings",
] as const;

export type AppId = (typeof APP_IDS)[number];

export type AppDefinition = {
  id: AppId;
  href: string;
  icon: string;
  /** Longest prefixes first — `/live-tracking-v2` before `/live-tracking`. */
  prefixes: readonly string[];
  groups: readonly string[];
  permissionAnyOf: readonly Permission[];
};

export const APP_REGISTRY: readonly AppDefinition[] = [
  {
    id: "visits",
    href: "/visit-bookings",
    icon: "Table2",
    prefixes: ["/visit-bookings", "/employeedesk/visits"],
    groups: [],
    permissionAnyOf: ["visits.view"],
  },
  {
    id: "employeedesk",
    href: "/employeedesk",
    icon: "Inbox",
    prefixes: ["/employeedesk", "/requests"],
    groups: ["EmployeeDesk"],
    permissionAnyOf: ["requests.view", "employeedesk.view"],
  },
  {
    id: "fleet",
    href: "/fleet",
    icon: "Truck",
    prefixes: ["/fleet", "/vehicles", "/fuel", "/assets"],
    groups: [],
    permissionAnyOf: ["vehicles.view", "fuel.view", "assets.view"],
  },
  {
    id: "operations",
    href: "/operations",
    icon: "Building2",
    prefixes: [
      "/operations",
      "/partners",
      "/restaurants",
      "/zones",
      "/delivery-rules",
      "/incentive-rules",
      "/performance",
      "/deliveries/reconciliation",
    ],
    groups: ["OperationsHub", "Operations"],
    permissionAnyOf: [
      "partners.view",
      "restaurants.view",
      "zones.view",
      "earnings.view",
      "performance.view",
    ],
  },
  {
    id: "payroll",
    href: "/payroll",
    icon: "Banknote",
    prefixes: ["/payroll"],
    groups: [],
    permissionAnyOf: ["payroll.view"],
  },
  {
    id: "live",
    href: "/live-tracking-v2",
    icon: "Radar",
    prefixes: ["/live-tracking-v2", "/live-tracking"],
    groups: [],
    permissionAnyOf: ["live_tracking.view", "drivers.view"],
  },
  {
    id: "settings",
    href: "/settings",
    icon: "Settings",
    prefixes: ["/settings"],
    groups: ["Settings", "System"],
    permissionAnyOf: ["settings.view"],
  },
];
