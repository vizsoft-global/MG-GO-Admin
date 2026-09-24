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

describe("stripFleetSidebar", () => {
  it("drops the Fleet group and its items from a saved menu", () => {
    const { tree } = mergeMenu([
      {
        id: "group-overview",
        type: "group",
        label: "Overview",
        icon: "Folder",
        children: [{ id: "dashboard", type: "item", label: "Dashboard", icon: "LayoutDashboard" }],
      },
      {
        id: "group-fleet",
        type: "group",
        label: "Fleet",
        icon: "Car",
        children: [
          { id: "vehicles", type: "item", label: "Vehicles", icon: "Bike" },
          { id: "fuel", type: "item", label: "Fuel", icon: "Fuel" },
          { id: "assets", type: "item", label: "Assets", icon: "Package", hidden: true },
        ],
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
    const ids = collectItemIds(tree);
    assert.equal(tree.find((node) => node.id === "group-fleet"), undefined);
    for (const id of ["vehicles", "fuel", "fuel-requests", "fuel-refunds", "assets", "asset-requests"]) {
      assert.equal(ids.includes(id), false, id);
    }
    assert.ok(ids.includes("dashboard"));
    assert.ok(ids.includes("drivers"));
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

describe("relocateStaffAccessItem", () => {
  it("pins Staff access after Roles in Settings", () => {
    const { tree } = mergeMenu([
      {
        id: "group-settings",
        type: "group",
        label: "Settings",
        icon: "Settings",
        children: [
          { id: "roles", type: "item", label: "Roles", icon: "Shield" },
          { id: "access-requests", type: "item", label: "Access", icon: "UserCheck" },
        ],
      },
    ]);
    const settings = tree.find((node) => node.id === "group-settings");
    const ids = (settings?.children ?? []).map((child) => child.id);
    const rolesAt = ids.indexOf("roles");
    const staffAt = ids.indexOf("staff-access");
    assert.ok(staffAt >= 0);
    assert.equal(staffAt, rolesAt + 1);
    assert.equal(settings?.children?.find((child) => child.id === "staff-access")?.hidden, false);
  });
});

describe("relocatePayrollItem", () => {
  it("pins Assistant after Performance and Payroll after Assistant", () => {
    const { tree } = mergeMenu([
      {
        id: "group-operations",
        type: "group",
        label: "Operations",
        icon: "Folder",
        children: [
          { id: "attendance", type: "item", label: "Attendance", icon: "ClipboardCheck" },
          { id: "performance", type: "item", label: "Performance", icon: "Gauge" },
        ],
      },
    ]);
    const ops = tree.find((node) => node.id === "group-operations");
    const ids = (ops?.children ?? []).map((child) => child.id);
    const perfIdx = ids.indexOf("performance");
    const assistantIdx = ids.indexOf("assistant");
    const payrollIdx = ids.indexOf("payroll");
    assert.ok(perfIdx >= 0);
    assert.equal(assistantIdx, perfIdx + 1);
    assert.equal(payrollIdx, assistantIdx + 1);
    assert.equal(ops?.children?.find((child) => child.id === "assistant")?.hidden, false);
    assert.equal(ops?.children?.find((child) => child.id === "payroll")?.hidden, false);
  });
});
