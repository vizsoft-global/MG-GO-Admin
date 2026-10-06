import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEsignBatchKpis } from "./esign-batch-kpis";

describe("esign batch kpis", () => {
  it("reads the RPC object and refuses an unauthorized payload", () => {
    assert.deepEqual(
      parseEsignBatchKpis({
        ok: true,
        batches_sent: 4,
        waiting_signatures: 7,
        fully_signed: 2,
        declined: 1,
      }),
      { batchesSent: 4, waitingSignatures: 7, fullySigned: 2, declined: 1 },
    );
    assert.equal(parseEsignBatchKpis({ ok: false, error: "not_authorized" }), null);
  });
});
