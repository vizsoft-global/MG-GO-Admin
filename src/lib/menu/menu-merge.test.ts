import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeMenu } from "./menu-merge";

function collectItemIds(nodes: { id: string; type: string; children?: { id: string; type: string; children?: { id: string; type: string }[] }[] }[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.type === "item") ids.push(node.id);
    if (node.children) ids.push(...collectItemIds(node.children));
  }
  return ids;
}

describe("relocateFleetItems", () => {
  it("pins Fleet after Overview with every fleet module unhidden", () => {
    const { tree } = mergeMenu([
      {
        id: "group-overview",
        type: "group",
        label: "Overview",
        icon: "Folder",
        children: [{ id: "dashboard", type: "item", label: "Dashboard", icon: "LayoutDashboard" }],
      },
      {
        id: "group-operations",
        type: "group",
        label: "Operations",
        icon: "Folder",
        children: [
          { id: "drivers", type: "item", label: "Drivers", icon: "Users" },
          { id: "fuel-requests", type: "item", label: "Fuel requests", icon: "ClipboardList" },
        ],
      },
    ]);
    const overviewAt = tree.findIndex((node) => node.id === "group-overview");
    const fleet = tree.find((node) => node.id === "group-fleet");
    assert.ok(fleet);
    assert.equal(tree[overviewAt + 1]?.id, "group-fleet");
    assert.equal(fleet?.icon, "Car");
    const fleetIds = (fleet?.children ?? []).map((child) => child.id);
    assert.deepEqual(fleetIds, [
      "vehicles",
      "fuel",
      "fuel-requests",
      "fuel-refunds",
      "asset-requests",
    ]);
    assert.equal(fleet?.children?.every((child) => child.hidden !== true), true);
    assert.equal(fleet?.children?.find((child) => child.id === "fuel")?.label, "Fuel Log");
    const apps = tree.find((node) => node.id === "group-apps");
    assert.ok(apps);
    assert.ok((apps?.children ?? []).some((child) => child.id === "assets"));
    const opsIds = (tree.find((node) => node.id === "group-operations")?.children ?? []).map(
      (child) => child.id,
    );
    assert.equal(opsIds.includes("fuel-requests"), false);
    assert.ok(opsIds.includes("drivers"));
  });
});

describe("relocateOrderReconItem", () => {
  it("pins Order reconciliation after Live Deliveries", () => {
    const { tree } = mergeMenu([
      {
        id: "group-operations",
        type: "group",
        label: "Operations",
        icon: "Folder",
        children: [
          { id: "deliveries", type: "item", label: "Live Deliveries", icon: "Package" },
          { id: "dpd-verification", type: "item", label: "DPD", icon: "ClipboardCheck" },
        ],
      },
    ]);
    const ops = tree.find((node) => node.id === "group-operations");
    const ids = (ops?.children ?? []).map((child) => child.id);
    const deliveriesAt = ids.indexOf("deliveries");
    const reconAt = ids.indexOf("order-reconciliation");
    assert.ok(reconAt >= 0);
    assert.equal(reconAt, deliveriesAt + 1);
    assert.equal(
      ops?.children?.find((child) => child.id === "order-reconciliation")?.hidden,
      false,
    );
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

  it("moves every operational setting out of Settings and Fleet into one group", () => {
    const { tree } = mergeMenu(legacyConfig);
    const hub = tree.find((node) => node.id === "group-operationshub");
    assert.ok(hub, "OperationsHub group should exist");
    assert.deepEqual(
      (hub?.children ?? []).map((child) => child.id),
      [
        "operations-hub",
        "partners",
        "restaurants",
        "zones",
        "delivery-rules",
        "incentive-rules",
        "driver-fields",
        "attendance-settings",
        "vehicle-types",
        "vehicle-uses",
        "source-companies",
      ],
    );

    const settingsIds = (tree.find((node) => node.id === "group-settings")?.children ?? []).map(
      (child) => child.id,
    );
    for (const id of [
      "partners",
      "restaurants",
      "zones",
      "delivery-rules",
      "incentive-rules",
      "driver-fields",
      "attendance-settings",
    ]) {
      assert.equal(settingsIds.includes(id), false, `${id} should have left Settings`);
    }
    assert.ok(settingsIds.includes("roles"));

    // The Fleet group is rebuilt from the registry, so a hub item parked there
    // must be collected before that happens or it is dropped entirely.
    const fleetIds = (tree.find((node) => node.id === "group-fleet")?.children ?? []).map(
      (child) => child.id,
    );
    assert.equal(fleetIds.includes("vehicle-types"), false);
    assert.equal(fleetIds.includes("vehicle-uses"), false);
    assert.equal(fleetIds.includes("source-companies"), false);
    assert.ok(fleetIds.includes("vehicles"));
  });

  it("places OperationsHub beside EmployeeDesk, not at the end of the tree", () => {
    const { tree } = mergeMenu(legacyConfig);
    const employeeAt = tree.findIndex((node) => node.id === "group-employeedesk");
    const hubAt = tree.findIndex((node) => node.id === "group-operationshub");
    assert.ok(employeeAt >= 0 && hubAt >= 0);
    assert.equal(hubAt, employeeAt + 1);
  });

  it("keeps the hub itself visible and preserves an icon the tenant chose", () => {
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
    const hub = tree.find((node) => node.id === "group-operationshub");
    const hubItem = hub?.children?.find((child) => child.id === "operations-hub");
    assert.equal(hubItem?.label, "Ops hub");
    assert.equal(hubItem?.icon, "Boxes");
    assert.equal(hubItem?.hidden, false);
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
    assert.deepEqual(
      (hubs[0].children ?? []).map((child) => child.id),
      ["operations-hub", "partners", "restaurants", "zones", "delivery-rules", "incentive-rules", "driver-fields", "attendance-settings", "vehicle-types", "vehicle-uses", "source-companies"],
    );
  });
});

describe("relocatePayrollItem", () => {
  it("pins Payroll after Performance and Assistant after Payroll in Operations", () => {
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
    const ops = tree.find((node) => node.id === "group-operations");
    const ids = (ops?.children ?? []).map((child) => child.id);
    const perfIdx = ids.indexOf("performance");
    const payrollIdx = ids.indexOf("payroll");
    const assistantIdx = ids.indexOf("assistant");
    assert.ok(perfIdx >= 0);
    assert.equal(payrollIdx, perfIdx + 1);
    assert.equal(assistantIdx, payrollIdx + 1);
    assert.equal(ops?.children?.find((child) => child.id === "payroll")?.hidden, false);
    assert.equal(tree.some((node) => node.id === "group-payroll"), false);
  });
});
