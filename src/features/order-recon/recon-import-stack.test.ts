import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextUndoSeq, redoTargetId, undoTargetId, type ReconImportTip } from "./recon-import-stack";

function tip(partial: Partial<ReconImportTip> & Pick<ReconImportTip, "id" | "status">): ReconImportTip {
  return {
    createdAt: "2026-09-24T10:00:00.000Z",
    undoSeq: null,
    redoable: true,
    ...partial,
  };
}

describe("recon-import-stack", () => {
  it("undos the newest applied run", () => {
    const runs = [
      tip({ id: "old", status: "applied", createdAt: "2026-09-23T10:00:00.000Z" }),
      tip({ id: "new", status: "applied", createdAt: "2026-09-24T10:00:00.000Z" }),
    ];
    assert.equal(undoTargetId(runs), "new");
  });

  it("redos the highest undo_seq that is still redoable", () => {
    const runs = [
      tip({ id: "a", status: "undone", undoSeq: 1, redoable: true }),
      tip({ id: "b", status: "undone", undoSeq: 2, redoable: true }),
      tip({ id: "c", status: "undone", undoSeq: 3, redoable: false }),
    ];
    assert.equal(redoTargetId(runs), "b");
    assert.equal(nextUndoSeq(runs), 4);
  });

  it("has nothing to undo or redo on an empty list", () => {
    assert.equal(undoTargetId([]), null);
    assert.equal(redoTargetId([]), null);
  });
});
