import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeMenu, resolveForSidebar } from "./menu-merge";

type TestNode = {
  id: string;
  type: string;
  label?: string;
  icon?: string;
  hidden?: boolean;
  children?: TestNode[];
};

function siblingIds(nodes: TestNode[], id: string): string[] | null {
  if (nodes.some((node) => node.id === id)) return nodes.map((node) => node.id);
  for (const node of nodes) {
    if (!node.children) continue;
    const found = siblingIds(node.children, id);
    if (found) return found;
  }
  return null;
}

function findNode(nodes: TestNode[], id: string): TestNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function collectItemIds(nodes: { id: string; type: string; children?: { id: string; type: string; children?: { id: string; type: string }[] }[] }[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.type === "item") ids.push(node.id);
    if (node.children) ids.push(...collectItemIds(node.children));
  }
  return ids;
}

describe("saved menu layout", () => {
  it("keeps Fleet Hub where the editor saved it and drops retired fleet items", () => {
    const { tree } = mergeMenu([
      {
        id: "group-operations",
        type: "group",
        label: "Operations",
        icon: "Folder",
        children: [
          { id: "vehicles", type: "item", label: "Bikes", icon: "Bike" },
          { id: "drivers", type: "item", label: "Drivers", icon: "Users" },
          { id: "fuel-requests", type: "item", label: "Fuel requests", icon: "ClipboardList" },
        ],
      },
    ]);
    const ops = tree.find((node) => node.id === "group-operations");
    const ids = (ops?.children ?? []).map((child) => child.id);
    assert.deepEqual(ids.slice(0, 2), ["vehicles", "drivers"]);
    assert.equal(ids.includes("fuel-requests"), false);
    assert.equal(findNode(tree, "vehicles")?.label, "Bikes");
    const fleetSiblings = siblingIds(tree, "vehicles");
    assert.notEqual(fleetSiblings?.[fleetSiblings.indexOf("vehicles") + 1], "dpd-verification");
  });
});

describe("relocateOrderReconItem", () => {
  it("strips leftover reconciliation so it is a hub card, not a sidebar row", () => {
    const { tree } = mergeMenu([
      {
        id: "group-operations",
        type: "group",
        label: "Operations",
        icon: "Folder",
        children: [
          { id: "deliveries", type: "item", label: "Live Deliveries", icon: "Package" },
          { id: "order-reconciliation", type: "item", label: "Recon", icon: "Scale", hidden: true },
          { id: "dpd-verification", type: "item", label: "DPD", icon: "ClipboardCheck" },
        ],
      },
    ]);
    const opsIds = (tree.find((node) => node.id === "group-operations")?.children ?? []).map(
      (child) => child.id,
    );
    assert.deepEqual(opsIds.slice(0, 2), ["deliveries", "dpd-verification"]);
    assert.equal(findNode(tree, "order-reconciliation"), null);
  });
});

describe("stripStaffAccessItem", () => {
  it("drops the leftover Staff access item from saved Settings menus", () => {
    const { tree } = mergeMenu([
      {
        id: "group-settings",
        type: "group",
        label: "Settings",
        icon: "Settings",
        children: [
          { id: "roles", type: "item", label: "Roles", icon: "Shield" },
          { id: "staff-access", type: "item", label: "Staff access", icon: "KeyRound" },
          { id: "access-requests", type: "item", label: "Access", icon: "UserCheck" },
        ],
      },
    ]);
    const settings = tree.find((node) => node.id === "group-settings");
    const ids = (settings?.children ?? []).map((child) => child.id);
    assert.equal(ids.includes("staff-access"), false);
    assert.ok(ids.includes("roles"));
    assert.ok(ids.includes("access-requests"));
  });
});

describe("relocateOperationsHubItems", () => {
  const legacyConfig = [
    {
      id: "group-overview",
      type: "group" as const,
      label: "Overview",
      icon: "Folder",
      children: [{ id: "dashboard", type: "item" as const, label: "Dashboard", icon: "LayoutDashboard" }],
    },
    {
      id: "group-employeedesk",
      type: "group" as const,
      label: "EmployeeDesk",
      icon: "Inbox",
      children: [
        { id: "employeedesk", type: "item" as const, label: "EmployeeDesk", icon: "Inbox" },
      ],
    },
    {
      id: "group-settings",
      type: "group" as const,
      label: "Settings",
      icon: "Settings",
      children: [
        { id: "roles", type: "item" as const, label: "Roles", icon: "Shield" },
        { id: "partners", type: "item" as const, label: "Partners", icon: "Handshake" },
        { id: "restaurants", type: "item" as const, label: "Restaurants", icon: "UtensilsCrossed" },
        { id: "zones", type: "item" as const, label: "Zones", icon: "Map" },
        { id: "delivery-rules", type: "item" as const, label: "Delivery rules", icon: "ScrollText" },
        { id: "incentive-rules", type: "item" as const, label: "Incentive rules", icon: "Coins" },
        { id: "driver-fields", type: "item" as const, label: "Driver fields", icon: "FormInput" },
        { id: "attendance-settings", type: "item" as const, label: "Attendance", icon: "Timer" },
        { id: "driver-app", type: "item" as const, label: "Driver app", icon: "Smartphone" },
        { id: "storage", type: "item" as const, label: "Storage", icon: "HardDrive" },
      ],
    },
    {
      id: "group-fleet",
      type: "group" as const,
      label: "Fleet",
      icon: "Car",
      children: [
        { id: "vehicles", type: "item" as const, label: "Vehicles", icon: "Bike" },
        { id: "vehicle-types", type: "item" as const, label: "Vehicle types", icon: "List" },
        { id: "vehicle-uses", type: "item" as const, label: "Vehicle uses", icon: "List" },
        { id: "source-companies", type: "item" as const, label: "Companies", icon: "Building2" },
      ],
    },
  ];

  it("keeps operational settings in the groups the editor saved", () => {
    const { tree } = mergeMenu(legacyConfig);
    const settingsIds = (tree.find((node) => node.id === "group-settings")?.children ?? []).map(
      (child) => child.id,
    );
    assert.ok(settingsIds.includes("partners"));
    assert.ok(settingsIds.includes("roles"));
    assert.equal(settingsIds.includes("driver-app"), true);
    const fleetIds = (tree.find((node) => node.id === "group-fleet")?.children ?? []).map(
      (child) => child.id,
    );
    assert.deepEqual(fleetIds, ["vehicles", "source-companies"]);
    assert.equal(findNode(tree, "vehicles")?.label, "Vehicles");
    const hubIds = (tree.find((node) => node.id === "group-operationshub")?.children ?? []).map(
      (child) => child.id,
    );
    assert.ok(hubIds.includes("earnings"));
    assert.equal(hubIds.includes("performance"), false);
    assert.equal(hubIds.includes("order-reconciliation"), false);
    assert.equal(findNode(tree, "performance"), null);
    assert.equal(findNode(tree, "order-reconciliation"), null);
    assert.equal(settingsIds.includes("performance"), false);
  });

  it("does not move a saved root order down between System and Unorganised", () => {
    const { tree } = mergeMenu([
      { id: "visit-bookings", type: "item", label: "Visit Bookings", icon: "Calendar" },
      { id: "attendance", type: "item", label: "Attendance", icon: "ClipboardCheck" },
      { id: "operations-hub", type: "item", label: "OperationsHub", icon: "Building2" },
      {
        id: "group-system",
        type: "group",
        label: "System",
        icon: "Settings",
        children: [{ id: "maintenance", type: "item", label: "Maintenance", icon: "Wrench" }],
      },
    ]);
    assert.equal(tree[0]?.id, "visit-bookings");
    assert.equal(tree[1]?.id, "attendance");
    assert.equal(tree[2]?.id, "operations-hub");
    const hubIds = (tree.find((node) => node.id === "group-operationshub")?.children ?? []).map(
      (child) => child.id,
    );
    assert.ok(hubIds.includes("earnings"));
    assert.equal(hubIds.includes("performance"), false);
    assert.equal(hubIds.includes("order-reconciliation"), false);
    assert.equal(findNode(tree, "performance"), null);
    assert.equal(findNode(tree, "order-reconciliation"), null);
  });

  it("keeps a hidden OperationsHub row in the group it was saved in", () => {
    const config = [
      {
        id: "group-settings",
        type: "group" as const,
        label: "Settings",
        icon: "Settings",
        children: [
          {
            id: "operations-hub",
            type: "item" as const,
            label: "Ops hub",
            icon: "Boxes",
            hidden: true,
          },
          { id: "partners", type: "item" as const, label: "Partners", icon: "Handshake" },
        ],
      },
    ];
    const { tree } = mergeMenu(config);
    const hubItem = tree
      .find((node) => node.id === "group-settings")
      ?.children?.find((child) => child.id === "operations-hub");
    assert.equal(hubItem?.label, "Ops hub");
    assert.equal(hubItem?.icon, "Boxes");
    assert.equal(hubItem?.hidden, true);
  });

  it("does not add the group twice when the saved config already has it", () => {
    const { tree } = mergeMenu([
      {
        id: "group-operationshub",
        type: "group" as const,
        label: "OperationsHub",
        icon: "Building2",
        children: [
          { id: "operations-hub", type: "item" as const, label: "OperationsHub", icon: "Building2" },
          { id: "zones", type: "item" as const, label: "Zones", icon: "Map" },
        ],
      },
    ]);
    const hubs = tree.filter((node) => node.id === "group-operationshub");
    assert.equal(hubs.length, 1);
    const hubIds = (hubs[0].children ?? []).map((child) => child.id);
    assert.deepEqual(hubIds.slice(0, 2), ["operations-hub", "zones"]);
    assert.ok(hubIds.includes("earnings"));
    assert.equal(hubIds.includes("performance"), false);
    assert.equal(hubIds.includes("order-reconciliation"), false);
  });
});

describe("relocatePayrollItem", () => {
  it("keeps a saved Payroll row and its label", () => {
    const { tree } = mergeMenu([
      {
        id: "group-operations",
        type: "group",
        label: "Operations",
        icon: "Folder",
        children: [
          { id: "attendance", type: "item", label: "Attendance", icon: "ClipboardCheck" },
          { id: "performance", type: "item", label: "Performance", icon: "Gauge" },
          { id: "payroll", type: "item", label: "Payroll & Requests", icon: "CalendarClock" },
        ],
      },
    ]);
    const ids = (tree.find((node) => node.id === "group-operations")?.children ?? []).map(
      (child) => child.id,
    );
    assert.equal(ids.includes("performance"), false);
    assert.ok(ids.includes("payroll"));
    assert.equal(findNode(tree, "payroll")?.label, "Payroll");
    assert.equal(findNode(tree, "payroll")?.icon, "Banknote");
    assert.equal(findNode(tree, "performance"), null);
    const payoutSiblings = siblingIds(tree, "payouts");
    assert.notEqual(payoutSiblings?.[payoutSiblings.indexOf("payouts") + 1], "payroll");
  });
});

describe("sidebar hides retired Requests and EmployeeDesk visits", () => {
  it("omits hidden registry items from the resolved sidebar", () => {
    const { tree } = mergeMenu([]);
    const ids = collectItemIds(tree);
    assert.equal(ids.includes("requests"), false);
    assert.equal(ids.includes("employeedesk-visits"), false);
    assert.equal(ids.includes("fuel-requests"), false);
    assert.equal(ids.includes("fuel-refunds"), false);
    assert.equal(ids.includes("asset-requests"), false);
    assert.ok(ids.includes("visit-bookings"));
    assert.ok(ids.includes("employeedesk"));
    assert.equal(tree.some((node) => node.id === "group-visit bookings"), false);
    assert.equal(tree.some((node) => node.id === "group-fleet"), false);
    assert.equal(tree.some((node) => node.id === "group-apps"), false);
    const employeeAt = tree.findIndex((node) => node.id === "group-employeedesk");
    assert.equal(tree[employeeAt + 1]?.id, "group-operations");
    const systemAt = tree.findIndex((node) => node.id === "group-system");
    const unorgAt = tree.findIndex((node) => node.id === "group-unorganised");
    assert.equal(tree[systemAt + 1]?.id, "group-operationshub");
    assert.equal(tree[systemAt + 2]?.id, "operations-hub");
    assert.equal(tree[systemAt + 3]?.id, "attendance");
    assert.equal(tree[systemAt + 4]?.id, "visit-bookings");
    if (unorgAt >= 0) assert.equal(unorgAt, systemAt + 5);
    const opsIds = (tree.find((node) => node.id === "group-operations")?.children ?? []).map(
      (child) => child.id,
    );
    const deliveriesAt = opsIds.indexOf("deliveries");
    assert.equal(opsIds[deliveriesAt + 1], "vehicles");
    assert.equal(opsIds[deliveriesAt + 2], "dpd-verification");
    const payoutsAt = opsIds.indexOf("payouts");
    assert.equal(opsIds[payoutsAt + 1], "payroll");
    assert.equal(opsIds.includes("attendance"), false);
    assert.equal(opsIds.includes("performance"), false);
    assert.equal(opsIds.includes("order-reconciliation"), false);
    const hubIds = (tree.find((node) => node.id === "group-operationshub")?.children ?? []).map(
      (child) => child.id,
    );
    assert.equal(hubIds.includes("performance"), false);
    assert.equal(hubIds.includes("order-reconciliation"), false);
    assert.ok(hubIds.includes("earnings"));
    assert.equal(findNode(tree, "performance"), null);
    assert.equal(findNode(tree, "order-reconciliation"), null);
    assert.equal(findNode(tree, "visit-bookings")?.label, "Visit Slots");
    assert.equal(findNode(tree, "visit-bookings")?.icon, "Table2");
    assert.equal(findNode(tree, "vehicles")?.icon, "Truck");
    assert.equal(findNode(tree, "payroll")?.icon, "Banknote");
    assert.equal(opsIds.includes("document-expiry"), false);
    const systemIds = (tree.find((node) => node.id === "group-system")?.children ?? []).map(
      (child) => child.id,
    );
    const driverAppAt = systemIds.indexOf("driver-app");
    assert.ok(driverAppAt >= 0);
    assert.equal(systemIds[driverAppAt + 1], "document-expiry");
    assert.ok(systemIds.includes("assistant"));
    assert.equal(opsIds.includes("assistant"), false);
  });

  it("strips a saved Requests item at resolveForSidebar", () => {
    const { tree } = mergeMenu([
      {
        id: "group-wip",
        type: "group",
        label: "WIP",
        icon: "AlertTriangle",
        children: [
          { id: "requests", type: "item", label: "Requests", icon: "Inbox" },
          { id: "wrong-actions", type: "item", label: "Wrong Actions", icon: "AlertTriangle" },
        ],
      },
    ]);
    const mergedIds = collectItemIds(tree);
    assert.equal(mergedIds.includes("requests"), false);
    const resolved = resolveForSidebar(tree, () => true, true);
    const resolvedIds = collectItemIds(resolved);
    assert.equal(resolvedIds.includes("requests"), false);
    assert.ok(resolvedIds.includes("wrong-actions"));
  });
});

describe("remapClientIaSavedMenu", () => {
  it("moves named leftover rows and rewrites stale Fleet / Payroll / Visit labels", () => {
    const { tree } = mergeMenu([
      {
        id: "group-operations",
        type: "group",
        label: "Operations",
        icon: "Folder",
        children: [
          { id: "deliveries", type: "item", label: "Live Deliveries", icon: "Package" },
          { id: "performance", type: "item", label: "Performance", icon: "BarChart3" },
          { id: "assistant", type: "item", label: "Staff Assistant", icon: "Sparkles" },
          { id: "earnings", type: "item", label: "Earnings", icon: "Wallet" },
        ],
      },
      {
        id: "group-system",
        type: "group",
        label: "System",
        icon: "Settings",
        children: [
          { id: "driver-devices", type: "item", label: "Driver devices", icon: "Smartphone" },
          { id: "maintenance", type: "item", label: "Maintenance", icon: "Wrench" },
        ],
      },
      {
        id: "group-wip",
        type: "group",
        label: "WIP",
        icon: "AlertTriangle",
        children: [
          { id: "support", type: "item", label: "Support", icon: "LifeBuoy" },
          { id: "wrong-actions", type: "item", label: "Wrong Actions", icon: "AlertTriangle" },
        ],
      },
      { id: "vehicles", type: "item", label: "Fleet Hub", icon: "Car" },
      { id: "visit-bookings", type: "item", label: "Visit Bookings", icon: "CalendarCheck" },
      { id: "payroll", type: "item", label: "Payroll & Requests", icon: "CalendarClock" },
    ]);
    const hubIds = (tree.find((node) => node.id === "group-operationshub")?.children ?? []).map(
      (child) => child.id,
    );
    assert.equal(hubIds.includes("performance"), false);
    assert.ok(hubIds.includes("earnings"));
    assert.equal(findNode(tree, "performance"), null);
    const settingsIds = (tree.find((node) => node.id === "group-settings")?.children ?? []).map(
      (child) => child.id,
    );
    assert.ok(settingsIds.includes("driver-devices"));
    assert.ok(settingsIds.includes("support"));
    const opsIds = (tree.find((node) => node.id === "group-operations")?.children ?? []).map(
      (child) => child.id,
    );
    assert.ok(opsIds.includes("wrong-actions"));
    assert.equal(opsIds.includes("performance"), false);
    assert.equal(opsIds.includes("assistant"), false);
    const systemIds = (tree.find((node) => node.id === "group-system")?.children ?? []).map(
      (child) => child.id,
    );
    assert.ok(systemIds.includes("assistant"));
    assert.equal(findNode(tree, "vehicles")?.icon, "Truck");
    assert.equal(findNode(tree, "visit-bookings")?.label, "Visit Slots");
    assert.equal(findNode(tree, "visit-bookings")?.icon, "Table2");
    assert.equal(findNode(tree, "payroll")?.label, "Payroll");
    assert.equal(findNode(tree, "payroll")?.icon, "Banknote");
  });

  it("drops leftover Requests and remaps EmployeeDesk settings after reports", () => {
    const { tree } = mergeMenu([
      {
        id: "group-wip",
        type: "group",
        label: "WIP",
        icon: "AlertTriangle",
        children: [{ id: "requests", type: "item", label: "Requests", icon: "Inbox" }],
      },
      {
        id: "group-reports",
        type: "group",
        label: "Reports",
        icon: "BarChart3",
        children: [
          { id: "employeedesk-settings", type: "item", label: "Settings", icon: "Settings" },
        ],
      },
      {
        id: "group-employeedesk",
        type: "group",
        label: "EmployeeDesk",
        icon: "Inbox",
        children: [
          { id: "employeedesk", type: "item", label: "EmployeeDesk", icon: "Inbox" },
          { id: "employeedesk-reports", type: "item", label: "Reports", icon: "BarChart3" },
        ],
      },
    ]);
    assert.equal(findNode(tree, "requests"), null);
    const desk = tree.find((node) => node.id === "group-employeedesk");
    const deskIds = (desk?.children ?? []).map((child) => child.id);
    assert.ok(deskIds.includes("employeedesk-settings"));
    assert.ok(deskIds.indexOf("employeedesk-reports") < deskIds.indexOf("employeedesk-settings"));
    assert.equal(findNode(tree, "employeedesk-settings")?.label, "EmployeeDesk settings");
  });
});
