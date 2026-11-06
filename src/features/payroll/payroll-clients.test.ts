import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PAYROLL_CLIENTS,
  findPayrollClient,
  normalizePayrollClientKey,
  payrollClientExportName,
  payrollClientKeyFromName,
  payrollClientLabel,
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
});
