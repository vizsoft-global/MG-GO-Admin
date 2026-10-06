import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scopeSidebar } from "./app-scope";

const TREE = [
  {
    id: "group-operations",
    type: "group" as const,
    label: "Operations",
    icon: "Folder",
    children: [
      { id: "drivers", type: "item" as const, label: "Employees", icon: "Users", href: "/drivers" },
      { id: "deliveries", type: "item" as const, label: "Deliveries", icon: "Package", href: "/deliveries" },
    ],
  },
  {
    id: "group-employeedesk",
    type: "group" as const,
    label: "EmployeeDesk",
    icon: "Inbox",
    children: [
      { id: "employeedesk", type: "item" as const, label: "EmployeeDesk", icon: "Inbox", href: "/employeedesk" },
    ],
  },
];

describe("flat sidebar", () => {
  it("no longer scopes the tree to the active app", () => {
    const scoped = scopeSidebar(TREE, "/en/employeedesk");
    assert.equal(scoped.appId, null);
    assert.equal(scoped.nodes.length, 2);
    assert.deepEqual(
      scoped.nodes.flatMap((n) => n.children?.map((c) => c.id) ?? []),
      ["drivers", "deliveries", "employeedesk"],
    );
  });
});
