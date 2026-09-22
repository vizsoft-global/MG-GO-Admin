import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeMenu } from "./menu-merge";

describe("relocateFleetItems", () => {
  it("pins every Fleet registry item even when a saved menu hid Assets", () => {
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
          { id: "assets", type: "item", label: "Assets", icon: "Package", hidden: true },
          { id: "vehicles", type: "item", label: "Vehicles", icon: "Bike" },
        ],
      },
    ]);
    const fleet = tree.find((node) => node.id === "group-fleet");
    const ids = (fleet?.children ?? []).map((child) => child.id);
    assert.ok(ids.includes("assets"));
    assert.ok(ids.includes("vehicles"));
    assert.equal(fleet?.children?.find((child) => child.id === "assets")?.hidden, false);
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
