import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slotsForKind as functionSlotsForKind } from "../../../../functions/src/rpcs/esign-signature-slots";
import { LOAN_SLOTS, slotsForKind } from "./esign-document-layout";
import {
  buildEsignDocumentHtml,
  sampleEmployee,
} from "./esign-document-html";

const EMPLOYEE = sampleEmployee();

function loanHtml(): string {
  return buildEsignDocumentHtml({
    language: "en",
    kind: "loan",
    headerEn: "Loan Request",
    headerAr: "طلب سلفة",
    employee: EMPLOYEE,
  });
}

describe("L2 loan reference sheet", () => {
  it("prints the L2 Arabic strings exactly", () => {
    const html = loanHtml();
    assert.match(html, /المهنة/);
    assert.match(html, /التحقق من الموارد البشرية/);
    assert.match(
      html,
      /أقرّ بصحة البيانات أعلاه، وأفوّض الشركة بخصم الأقساط من راتبي وتسوية أي رصيد متبقٍّ من مستحقاتي النهائية عند انتهاء خدمتي/,
    );
    assert.match(html, /وفق تقديرها، ويكون القرار نهائياً/);
  });

  it("prints only the employee and hr signature slots", () => {
    const html = loanHtml();
    const roles = [...html.matchAll(/data-slot-role="([^"]+)"/g)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(roles, ["employee", "hr"]);
    assert.doesNotMatch(html, /data-slot-role="ceo"/);
    assert.doesNotMatch(html, /ack_received|ack_not_received/);
  });

  it("renders the management signature as a table row, not a floating band", () => {
    const html = loanHtml();
    assert.match(html, /<td class="ref-lab">Management signature<\/td>/);
    assert.match(html, /توقيع الإدارة/);
    assert.doesNotMatch(html, /ref-mgmt-sign/);
  });

  it("keeps Section 01/02 rows and the section order", () => {
    const html = loanHtml();
    // Empty values are omitted entirely, so only the always-printed signature
    // rows are asserted here; the blank contract is checked just below.
    for (const label of ["Employee signature", "Management signature"]) {
      assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(html, /<td class="ref-val">—<\/td>/);
    const order = [
      "Employee Information",
      "Loan Request",
      "HR Verification",
      "Management Decision",
    ].map((title) => html.indexOf(title));
    assert.ok(order.every((value, index) => value >= 0 && (index === 0 || value > order[index - 1])));
  });

  it("keeps the Next and functions fallbacks at two slots", () => {
    assert.equal(LOAN_SLOTS.length, 2);
    assert.equal(functionSlotsForKind("loan").length, 2);
    assert.deepEqual(
      slotsForKind("loan").map((slot) => slot.role),
      ["employee", "hr"],
    );
    assert.deepEqual(
      functionSlotsForKind("loan").map((slot) => slot.role),
      ["employee", "hr"],
    );
  });
});
