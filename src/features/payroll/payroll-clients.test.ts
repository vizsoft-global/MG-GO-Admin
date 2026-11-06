import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PAYROLL_CLIENTS,
  PAYROLL_RULE_KINDS,
  findPayrollClient,
  isPayrollRuleKind,
  normalizePayrollClientKey,
  payrollClientExportName,
  payrollClientKeyFromName,
  payrollClientLabel,
  resolvePayrollClientToken,
} from "./payroll-clients";

/**
 * The client catalog is the one list behind the Employee Client dropdown, the HR
 * Payroll Client Name cell and Attendance & Orders. These cases pin the rules
 * that keep a key stable: a name becomes a slug once, and every spelling an
 * operator or a spreadsheet produces resolves to the same stored key.
 */

describe("client keys", () => {
  it("slugs a name the way the other catalogs do", () => {
    assert.equal(payrollClientKeyFromName("Al Musallam"), "al_musallam");
    assert.equal(payrollClientKeyFromName("  Five Guys  "), "five_guys");
    assert.equal(payrollClientKeyFromName("Client #2"), "client_2");
    assert.equal(payrollClientKeyFromName("!!!"), "");
  });

  it("normalises the spellings an operator or a sheet produces", () => {
    for (const raw of ["keeta", "Keeta", " KEETA "]) {
      assert.equal(normalizePayrollClientKey(raw), "keeta", raw);
    }
    assert.equal(normalizePayrollClientKey("Five Guys"), "five_guys");
    assert.equal(normalizePayrollClientKey("five-guys"), "five_guys");
    assert.equal(normalizePayrollClientKey(""), null);
    assert.equal(normalizePayrollClientKey(null), null);
    // A key that cannot be a document id is refused rather than guessed.
    assert.equal(normalizePayrollClientKey("a".repeat(25)), null);
    assert.equal(normalizePayrollClientKey("عميل"), null);
  });
});

describe("the seeded clients", () => {
  it("keeps the three the SOP names, all system rows", () => {
    assert.deepEqual(
      DEFAULT_PAYROLL_CLIENTS.map((row) => row.key),
      ["americana", "keeta", "five_guys"],
    );
    for (const row of DEFAULT_PAYROLL_CLIENTS) {
      assert.equal(row.isSystem, true, row.key);
      assert.equal(row.isActive, true, row.key);
    }
  });

  it("prices Keeta and Five Guys on hours, Americana on orders", () => {
    const americana = findPayrollClient([...DEFAULT_PAYROLL_CLIENTS], "americana");
    const keeta = findPayrollClient([...DEFAULT_PAYROLL_CLIENTS], "Keeta");
    const fiveGuys = findPayrollClient([...DEFAULT_PAYROLL_CLIENTS], "five guys");
    assert.equal(americana?.usesHours, false);
    assert.equal(keeta?.usesHours, true);
    assert.equal(fiveGuys?.usesHours, true);
  });
});

describe("labels and export names", () => {
  it("prints the Arabic name only in Arabic", () => {
    const row = DEFAULT_PAYROLL_CLIENTS[0]!;
    assert.equal(payrollClientLabel(row, "en"), "Americana");
    assert.equal(payrollClientLabel(row, "ar"), row.nameAr);
    assert.equal(payrollClientLabel(null, "en"), "");
  });

  it("survives a key and a name with punctuation", () => {
    assert.equal(payrollClientExportName("al_musallam", "Al Musallam"), "Al-Musallam");
    assert.equal(payrollClientExportName("client_2", "Client #2"), "Client-2");
    assert.equal(payrollClientExportName("keeta", null), "Keeta");
  });

describe("resolvePayrollClientToken", () => {
  const rows = [
    { ...DEFAULT_PAYROLL_CLIENTS[0]! },
    {
      ...DEFAULT_PAYROLL_CLIENTS[0]!,
      key: "al_musallam",
      name: "Al Musallam",
      nameAr: "المسلم",
      isSystem: false,
      riderCount: 0,
    },
    {
      ...DEFAULT_PAYROLL_CLIENTS[0]!,
      key: "retired",
      name: "Retired Client",
      nameAr: "",
      isActive: false,
      isSystem: false,
      riderCount: 0,
    },
  ];

  it("resolves a key the sheet typed in any spelling", () => {
    assert.deepEqual(resolvePayrollClientToken("al_musallam", rows), {
      status: "ok",
      key: "al_musallam",
    });
    assert.deepEqual(resolvePayrollClientToken("Al Musallam", rows), {
      status: "ok",
      key: "al_musallam",
    });
    assert.deepEqual(resolvePayrollClientToken("المسلم", rows), {
      status: "ok",
      key: "al_musallam",
    });
  });

  it("always knows the three SOP clients, even before the catalog is seeded", () => {
    assert.deepEqual(resolvePayrollClientToken("Keeta", []), { status: "ok", key: "keeta" });
    assert.deepEqual(resolvePayrollClientToken("five guys", []), {
      status: "ok",
      key: "five_guys",
    });
  });

  it("refuses a name the catalog does not hold", () => {
    assert.deepEqual(resolvePayrollClientToken("Not A Client", rows), { status: "unknown" });
    assert.deepEqual(resolvePayrollClientToken("retired", rows), { status: "ok", key: "retired" });
    // A retired client's *name* is not a live assignment target.
    assert.deepEqual(resolvePayrollClientToken("Retired Client", rows), { status: "unknown" });
  });

  it("reads a blank cell as no opinion", () => {
    assert.deepEqual(resolvePayrollClientToken("", rows), { status: "empty" });
    assert.deepEqual(resolvePayrollClientToken(null, rows), { status: "empty" });
  });
});

describe("default-result kinds", () => {
  it("offers exactly the kinds the payroll engine prices", () => {
    assert.deepEqual([...PAYROLL_RULE_KINDS], [
      "12",
      "3h",
      "HALF",
      "ACT",
      "ABS",
      "ALH",
      "ALO",
      "CUS",
    ]);
    assert.equal(isPayrollRuleKind("HALF"), true);
    assert.equal(isPayrollRuleKind("half"), false);
    assert.equal(isPayrollRuleKind(""), false);
  });
});

});
