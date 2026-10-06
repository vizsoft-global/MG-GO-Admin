import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Permission } from "@/lib/auth/permissions";
import {
  incomingHubListFlags,
  incomingPendingTotal,
  rcmAccessChips,
  RCM_ADMIN_CHIPS,
  INCOMING_TYPE_KEYS,
} from "./rcm-access";

describe("rcm access chips", () => {
  it("marks Sender from requests.manage and Receiver from view or approve", () => {
    assert.deepEqual(rcmAccessChips(new Set<Permission>(["requests.manage"]), false), {
      sender: true,
      receiver: false,
    });
    assert.deepEqual(rcmAccessChips(new Set<Permission>(["requests.view"]), false), {
      sender: false,
      receiver: true,
    });
    assert.deepEqual(rcmAccessChips(new Set<Permission>(["requests.approve"]), false), {
      sender: false,
      receiver: true,
    });
    assert.equal(rcmAccessChips(new Set(), true).sender, true);
    assert.equal(rcmAccessChips(new Set(), true).receiver, true);
  });

  it("lists the nine incoming types and six admin chip hrefs", () => {
    assert.equal(INCOMING_TYPE_KEYS.length, 9);
    assert.deepEqual(
      RCM_ADMIN_CHIPS.map((chip) => chip.href),
      [
        "/employeedesk/esign/templates",
        "/employeedesk/all",
        "/employeedesk/reports",
        "/settings/logs?module=requests",
        "/employeedesk/settings",
        "/employeedesk/visits/calendar",
      ],
    );
  });

  it("sums pending incoming counts", () => {
    assert.equal(
      incomingPendingTotal({ leave: { pending: 2 }, loan: { pending: 3 }, fuel: { pending: 0 } }),
      5,
    );
  });

  it("maps Incoming hub chips onto existing list flags", () => {
    assert.deepEqual(incomingHubListFlags("all"), {
      assignedToMe: true,
      forwardedToMe: false,
      handledByMe: false,
      dueToday: false,
    });
    assert.deepEqual(incomingHubListFlags("due"), {
      assignedToMe: false,
      forwardedToMe: false,
      handledByMe: false,
      dueToday: true,
    });
    assert.deepEqual(incomingHubListFlags("forwarded"), {
      assignedToMe: false,
      forwardedToMe: true,
      handledByMe: false,
      dueToday: false,
    });
  });
});
