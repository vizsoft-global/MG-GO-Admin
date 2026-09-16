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

describe("relocatePayrollItem", () => {
  it("pins Payroll after Performance in Operations even when a saved menu omitted it", () => {
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
    const payrollIdx = ids.indexOf("payroll");
    const perfIdx = ids.indexOf("performance");
    assert.ok(payrollIdx >= 0);
    assert.equal(payrollIdx, perfIdx + 1);
    assert.equal(ops?.children?.find((child) => child.id === "payroll")?.hidden, false);
  });
});
