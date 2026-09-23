import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtml, fillPlaceholders, listPlaceholders } from "./esign-placeholders";

describe("fillPlaceholders", () => {
  it("fills known tokens and HTML-escapes values", () => {
    const out = fillPlaceholders(
      "Hello {{employee_name}} ({{employee_id}})",
      { employee_name: "Ali <B>", employee_id: "10421" },
    );
    assert.equal(out, "Hello Ali &lt;B&gt; (10421)");
  });

  it("replaces a missing value with empty", () => {
    assert.equal(fillPlaceholders("x{{zone}}y", {}), "xy");
  });

  it("lists placeholder keys", () => {
    assert.deepEqual(listPlaceholders("{{a}} {{b}} {{a}}"), ["a", "b"]);
  });

  it("escapes quotes and ampersands", () => {
    assert.equal(escapeHtml(`&"'`), "&amp;&quot;&#39;");
  });
});
