import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeMenu, resolveForSidebar } from "./menu-merge";
import {
  menuIconUploadMeta,
  sanitizeMenuIconColor,
  sanitizeMenuIconUrl,
  svgIconIsSafe,
} from "./menu-icon";
import type { MenuNode } from "@/services/menu-config-service";

const ICON = "/api/menu-icons/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png";

function findNode(nodes: MenuNode[], id: string): MenuNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

describe("menu icon", () => {
  it("keeps a same-origin upload path and a 6-digit color", () => {
    assert.equal(sanitizeMenuIconUrl(ICON), ICON);
    assert.equal(sanitizeMenuIconUrl("https://evil.example/a.png"), undefined);
    assert.equal(sanitizeMenuIconColor("#a73c24"), "#A73C24");
    assert.equal(sanitizeMenuIconColor("red"), undefined);
    assert.equal(typeof menuIconUploadMeta("image/png", 100), "object");
    assert.equal(menuIconUploadMeta("image/gif", 100), "icon_type");
    assert.equal(menuIconUploadMeta("image/png", 200_000), "icon_too_large");
    assert.equal(svgIconIsSafe("<svg><script>alert(1)</script></svg>"), false);
    assert.equal(svgIconIsSafe("<svg><path d='M0 0'/></svg>"), true);
  });

  it("keeps a custom icon on a hub the sidebar flattens", () => {
    const saved: MenuNode[] = [
      {
        id: "group-employeedesk",
        type: "group",
        label: "EmployeeDesk",
        icon: "Inbox",
        iconColor: "#112233",
        children: [
          {
            id: "employeedesk",
            type: "item",
            label: "EmployeeDesk",
            icon: "Inbox",
            iconUrl: ICON,
            iconColor: "#A73C24",
          },
        ],
      },
      {
        id: "group-fleet",
        type: "group",
        label: "Fleet",
        icon: "Car",
        children: [
          {
            id: "vehicles",
            type: "item",
            label: "Fleet Hub",
            icon: "Truck",
            iconUrl: ICON,
            iconColor: "#27273F",
          },
        ],
      },
    ];
    const { tree } = mergeMenu(saved);
    const desk = findNode(tree, "employeedesk");
    const fleet = findNode(tree, "vehicles");
    assert.equal(desk?.iconUrl, ICON);
    assert.equal(desk?.iconColor, "#A73C24");
    assert.equal(fleet?.iconUrl, ICON);
    assert.equal(fleet?.iconColor, "#27273F");

    const resolved = resolveForSidebar(
      [
        {
          id: "employeedesk",
          type: "item",
          label: "EmployeeDesk",
          icon: "Inbox",
          iconUrl: "https://evil.example/x.png",
          iconColor: "red",
        },
      ],
      () => true,
      true,
    );
    assert.equal(resolved[0]?.iconUrl, undefined);
    assert.equal(resolved[0]?.iconColor, undefined);
  });
});
