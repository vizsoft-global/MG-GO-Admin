import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listScopeFlags, parseRequestListScope } from "./request-list-scopes";

describe("request list scopes", () => {
  it("maps each scope to one filter flag", () => {
    assert.deepEqual(listScopeFlags("assigned"), {
      assignedToMe: true,
      forwardedToMe: false,
      handledByMe: false,
      dueToday: false,
    });
    assert.deepEqual(listScopeFlags("forwarded"), {
      assignedToMe: false,
      forwardedToMe: true,
      handledByMe: false,
      dueToday: false,
    });
    assert.deepEqual(listScopeFlags("handled"), {
      assignedToMe: false,
      forwardedToMe: false,
      handledByMe: true,
      dueToday: false,
    });
    assert.deepEqual(listScopeFlags("due"), {
      assignedToMe: false,
      forwardedToMe: false,
      handledByMe: false,
      dueToday: true,
    });
    assert.equal(listScopeFlags("action").assignedToMe, true);
    assert.deepEqual(listScopeFlags("all"), {
      assignedToMe: false,
      forwardedToMe: false,
      handledByMe: false,
      dueToday: false,
    });
  });

  it("parses only known scopes", () => {
    assert.equal(parseRequestListScope("forwarded"), "forwarded");
    assert.equal(parseRequestListScope("nope"), null);
  });
});
