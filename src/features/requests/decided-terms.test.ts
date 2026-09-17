import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decidedTerms,
  overlayDecisionTerms,
  stepMetaHasDecisionTerms,
} from "./decided-terms";
import type { RequestApprovalStep } from "./types";

function step(
  order: number,
  status: string,
  meta: Record<string, unknown>,
): RequestApprovalStep {
  return {
    id: `s${order}`,
    step_order: order,
    step_name: `Step ${order}`,
    role_key: "hr",
    status,
    decided_by: null,
    decided_at: null,
    decision_note: null,
    allowed_actions: ["approve"],
    meta,
    started_at: null,
    actor_display_name: null,
    sla_due_at: null,
    sla_breached_at: null,
    breach_action: null,
  };
}

describe("decidedTerms", () => {
  it("skips a later completed step with empty meta", () => {
    const terms = decidedTerms([
      step(2, "completed", {
        approved_amount: 120,
        approved_tenure_months: 6,
        deduction_start_date: "2026-09-17",
      }),
      step(3, "completed", {}),
    ]);
    assert.equal(terms?.approved_amount, 120);
    assert.equal(terms?.approved_tenure_months, 6);
    assert.equal(terms?.deduction_start_date, "2026-09-17");
  });

  it("returns null when no completed step stored terms", () => {
    assert.equal(decidedTerms([step(1, "completed", {}), step(2, "in_progress", {})]), null);
  });
});

describe("overlayDecisionTerms", () => {
  it("holds last-submitted terms while the server row is still empty", () => {
    const held = {
      approved_amount: 80,
      approved_tenure_months: 3,
      deduction_start_date: "2026-09-20",
    };
    assert.deepEqual(overlayDecisionTerms(null, held), held);
    assert.equal(stepMetaHasDecisionTerms({ approved_by: "Ada" }), false);
  });

  it("prefers server terms once they land", () => {
    const server = { approved_amount: 80, deduction_start_date: "2026-09-20" };
    const held = { approved_amount: 1, deduction_start_date: "2026-01-01" };
    assert.deepEqual(overlayDecisionTerms(server, held), server);
  });
});
