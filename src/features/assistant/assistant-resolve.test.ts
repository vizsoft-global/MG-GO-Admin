import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFocusId, focusLine, lastEntityFocus } from "./assistant-focus";
import { classifyQueryKind, finalizeResolve, redactedQueryMeta } from "./assistant-resolve";
import { assistantSystemPrompt } from "./assistant-prompt";
import { createAssistantTools } from "./assistant-tools";

describe("classifyQueryKind", () => {
  it("labels id, code, phone, email, month, name without storing the raw value", () => {
    assert.equal(classifyQueryKind("a1b2c3d4-e5f6-7890-abcd-ef1234567890"), "id");
    assert.equal(classifyQueryKind("10245"), "code");
    assert.equal(classifyQueryKind("10001"), "code");
    assert.equal(classifyQueryKind("+965 5555 1234"), "phone");
    assert.equal(classifyQueryKind("rider@example.com"), "email");
    assert.equal(classifyQueryKind("2026-08"), "month");
    assert.equal(classifyQueryKind("RCM-0074"), "ref");
    assert.equal(classifyQueryKind("Ahmed Eljack"), "name");
    const meta = redactedQueryMeta("+96555551234");
    assert.equal(meta.query_kind, "phone");
    assert.equal(meta.query_len, 12);
    assert.ok(!JSON.stringify(meta).includes("96555551234"));
  });
});

describe("finalizeResolve", () => {
  it("returns ok for one hit, ambiguous for several, not_found for none — never auto-picks", () => {
    assert.deepEqual(finalizeResolve([], "driver", "code"), {
      status: "not_found",
      entity_type: "driver",
      query_kind: "code",
    });
    const one = finalizeResolve([{ id: "d1", label: "10245 · A" }], "driver", "code");
    assert.equal(one.status, "ok");
    if (one.status === "ok") {
      assert.equal(one.match.id, "d1");
      assert.equal(one.focus.id, "d1");
    }
    const many = finalizeResolve(
      [
        { id: "d1", label: "10245 · A" },
        { id: "d2", label: "10246 · B" },
        { id: "d3", label: "10247 · C" },
        { id: "d4", label: "10248 · D" },
        { id: "d5", label: "10249 · E" },
        { id: "d6", label: "10250 · F" },
      ],
      "driver",
      "name",
    );
    assert.equal(many.status, "ambiguous");
    if (many.status === "ambiguous") {
      assert.equal(many.candidates.length, 5);
      assert.ok(!("match" in many));
    }
  });
});

describe("conversation focus", () => {
  it("reads the last ok entity from tool JSON and applies this/focus", () => {
    const messages = [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-result",
            output: {
              status: "ok",
              entity_type: "driver",
              match: { id: "drv-1", label: "10245 · Ahmed" },
              focus: { entity_type: "driver", id: "drv-1", label: "10245 · Ahmed", zone_id: "z1" },
            },
          },
        ],
      },
    ];
    const focus = lastEntityFocus(messages);
    assert.deepEqual(focus, {
      entity_type: "driver",
      id: "drv-1",
      label: "10245 · Ahmed",
      zone_id: "z1",
      driver_id: "drv-1",
    });
    assert.match(focusLine(focus), /driver id=drv-1/);
    assert.equal(applyFocusId("this", "driver", focus), "drv-1");
    assert.equal(applyFocusId("focus", "driver", focus), "drv-1");
    assert.equal(applyFocusId(undefined, "driver", focus), "drv-1");
    assert.equal(applyFocusId("other-id", "driver", focus), "other-id");
    assert.equal(applyFocusId("this", "zone", focus), "z1");
  });
});

describe("prompt + tool budget", () => {
  it("ships English and Arabic prompts and at most 13 model tools", () => {
    const en = assistantSystemPrompt("en", null);
    const ar = assistantSystemPrompt("ar", {
      entity_type: "driver",
      id: "drv-1",
      label: "10245",
    });
    assert.match(en, /Answer in English/);
    assert.match(ar, /أجب بالعربية/);
    assert.match(ar, /drv-1/);
    const tools = createAssistantTools();
    const keys = Object.keys(tools);
    assert.ok(keys.includes("dpd_efficiency"));
    assert.ok(keys.includes("export_report"));
    assert.ok(keys.includes("resolve_entity"));
    assert.ok(keys.includes("analytics_query"));
    assert.equal(keys.length, 13);
  });
});
