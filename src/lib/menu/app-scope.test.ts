import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveActiveApp, scopeSidebar, visibleApps } from "./app-scope";
import type { ResolvedMenuNode } from "./menu-merge";

const tree: ResolvedMenuNode[] = [
  {
    id: "group-employeedesk",
    type: "group",
    label: "EmployeeDesk",
    icon: "Inbox",
    children: [
      { id: "employeedesk", type: "item", label: "EmployeeDesk", icon: "Inbox", href: "/employeedesk" },
      { id: "signing", type: "item", label: "To sign", icon: "KeyRound", href: "/employeedesk/esign/signing" },
    ],
  },
  {
    id: "group-fleet",
    type: "group",
    label: "Fleet",
    icon: "Car",
    children: [
      { id: "vehicles", type: "item", label: "Vehicles", icon: "Car", href: "/vehicles" },
    ],
  },
  {
    id: "group-operations",
    type: "group",
    label: "Operations",
    icon: "Building2",
    children: [
      { id: "payroll", type: "item", label: "Payroll", icon: "Banknote", href: "/payroll" },
      { id: "zones", type: "item", label: "Zones", icon: "MapPin", href: "/zones" },
    ],
  },
];

describe("app scope", () => {
  it("treats the launcher and assistant as unscoped", () => {
    assert.equal(deriveActiveApp("/en/dashboard"), null);
    assert.equal(deriveActiveApp("/ar/dashboard/ops"), null);
    assert.equal(deriveActiveApp("/en/assistant"), null);
  });

  it("derives the app from the longest matching prefix", () => {
    assert.equal(deriveActiveApp("/en/employeedesk/esign/signing"), "employeedesk");
    assert.equal(deriveActiveApp("/en/live-tracking-v2"), "live");
    assert.equal(deriveActiveApp("/en/payroll/combined"), "payroll");
  });

  it("keeps the full tree on every path (flat sidebar)", () => {
    const scoped = scopeSidebar(tree, "/en/employeedesk/esign");
    assert.equal(scoped.appId, null);
    assert.equal(scoped.nodes.length, tree.length);
  });

  it("filters launcher tiles by permission", () => {
    const apps = visibleApps(new Set(["requests.view", "payroll.view"]), false);
    assert.deepEqual(
      apps.map((app) => app.id),
      ["employeedesk", "payroll"],
    );
  });
});
