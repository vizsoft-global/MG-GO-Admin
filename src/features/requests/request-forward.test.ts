import assert from "node:assert/strict";
import { describe, it } from "node:test";

function forwardReady(input: { toUserId: string; note: string; selfId?: string }): boolean {
  if (!input.toUserId || !input.note.trim()) return false;
  if (input.selfId && input.toUserId === input.selfId) return false;
  return true;
}

describe("request forward", () => {
  it("requires a colleague and a note, and refuses self", () => {
    assert.equal(forwardReady({ toUserId: "", note: "please take this" }), false);
    assert.equal(forwardReady({ toUserId: "u2", note: "   " }), false);
    assert.equal(forwardReady({ toUserId: "me", note: "take this", selfId: "me" }), false);
    assert.equal(forwardReady({ toUserId: "u2", note: "take this", selfId: "me" }), true);
  });
});
