import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_BANK_CODES } from "./employee-catalogs";
import {
  ibanMod97Valid,
  isKuwaitIban,
  maskBankNumber,
  sanitizeBankForLog,
  validateBankDetails,
} from "./bank-details";

describe("bank details", () => {
  it("masks account and IBAN the same way", () => {
    assert.equal(maskBankNumber("123456789012"), "1234…9012");
    assert.equal(maskBankNumber("KW12NBK0000000000000123456"), "KW12…3456");
    assert.equal(maskBankNumber(""), "—");
  });

  it("accepts NBK account numbers and refuses IBAN on NBK", () => {
    const ok = validateBankDetails(
      { bank_code: "nbk", account_number: "1234567890", currency: "KWD" },
      DEFAULT_BANK_CODES,
    );
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value.account_number, "1234567890");
      assert.equal(ok.value.iban, null);
    }
    const missing = validateBankDetails({ bank_code: "nbk" }, DEFAULT_BANK_CODES);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error, "account_required");
  });

  it("requires a valid Kuwait IBAN for other banks", () => {
    assert.equal(ibanMod97Valid("GB82WEST12345698765432"), true);
    assert.equal(isKuwaitIban("GB82WEST12345698765432"), false);
    const valid = "KW81CBKU0000000000001234560101";
    assert.equal(isKuwaitIban(valid), true);
    const ok = validateBankDetails({ bank_code: "kfh", iban: valid }, DEFAULT_BANK_CODES);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value.iban, valid);
      assert.equal(ok.value.account_number, null);
    }
    const short = validateBankDetails({ bank_code: "kfh", iban: "KW12NBK" }, DEFAULT_BANK_CODES);
    assert.equal(short.ok, false);
    if (!short.ok) assert.equal(short.error, "invalid_iban");
  });

  it("never keeps raw account fields in an audit payload", () => {
    const cleaned = sanitizeBankForLog({
      id: "d1",
      account_number: "1234567890",
      iban: "KW81CBKU0000000000001234560101",
      beneficiary_civil_id: "287010100001",
      bank_details: { account_number: "secret" },
    });
    assert.equal("account_number" in cleaned, false);
    assert.equal("iban" in cleaned, false);
    assert.equal("beneficiary_civil_id" in cleaned, false);
    assert.equal("bank_details" in cleaned, false);
    assert.equal(cleaned.id, "d1");
  });
});
