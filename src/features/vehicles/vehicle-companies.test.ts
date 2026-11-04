import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { companyKeyFromLabel, companyLabel, COMPANY_KEY_RE } from "./vehicle-companies";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The arguments object of one `callAdminFunction("…", { … })`, comments removed.
 *
 * Kept as a source assertion because the bug it guards against is invisible at
 * runtime from the panel's side: the callable answers `invalid_key`, the action
 * reports "use a short key", and nothing in the type system notices that the
 * argument was spelled differently from the name the function reads.
 */
function callArgs(file: string, rpc: string): string {
  const source = readFileSync(join(here, "..", "vehicles", file), "utf8");
  const call = new RegExp(`callAdminFunction\\("${rpc}",\\s*\\{([\\s\\S]*?)\\n\\s*\\}\\)`).exec(source);
  assert.ok(call, `the ${rpc} call is missing`);
  return call[1]
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("vehicle companies", () => {
  it("derives a stable key from a label", () => {
    assert.equal(companyKeyFromLabel("Honda Motor"), "honda_motor");
    assert.equal(companyKeyFromLabel("  Toyota  "), "toyota");
    assert.equal(companyKeyFromLabel("Yamaha-Motors"), "yamaha_motors");
  });

  it("accepts only the short key shape", () => {
    assert.equal(COMPANY_KEY_RE.test("honda"), true);
    assert.equal(COMPANY_KEY_RE.test("honda_motor"), true);
    assert.equal(COMPANY_KEY_RE.test("Honda Motor"), false);
    assert.equal(COMPANY_KEY_RE.test(""), false);
  });

  /**
   * A company name whose 32nd character is the separator used to derive a key
   * ending in `_`, which `COMPANY_KEY_RE` rejects — so a perfectly reasonable
   * name was refused before it ever reached the server.
   */
  it("never derives a key the validator would reject", () => {
    const names = [
      "Al Monjiz Express For Consumables Delivery",
      "Al Monjiz Express For Consumables",
      "Reliance Service Consumables Delivery",
      "Al Kuwaitiya For Consumables Delivery",
      "Abcdefghijklmnopqrstuvwxyzabcdef",
      "A".repeat(80),
    ];
    for (const name of names) {
      const key = companyKeyFromLabel(name);
      assert.ok(key.length > 0, name);
      assert.ok(key.length <= 32, `${name} → ${key} (${key.length})`);
      assert.equal(key.endsWith("_"), false, `${name} → ${key}`);
      assert.equal(COMPANY_KEY_RE.test(key), true, `${name} → ${key}`);
    }
  });

  it("prefers the Arabic label when the locale is Arabic", () => {
    const companies = [
      { key: "honda", label_en: "Honda", label_ar: "هوندا", is_active: true, sort_order: 1 },
    ];
    assert.equal(companyLabel("honda", companies, "ar"), "هوندا");
    assert.equal(companyLabel("honda", companies, "en"), "Honda");
    assert.equal(companyLabel("missing", companies, "en"), "missing");
    assert.equal(companyLabel(null, companies, "en"), "—");
  });
});

describe("vehicle company save contract", () => {
  it("sends camelCase arguments, like the other catalog upserts", () => {
    const args = callArgs("vehicle-companies-actions.ts", "admin_upsert_vehicle_company");
    assert.equal(
      /\bp_[a-z_]+[,:]/.test(args),
      false,
      "the call sends a p_snake_case argument the function reads under another name",
    );
    for (const required of ["key", "labelEn", "labelAr", "isActive"]) {
      assert.ok(
        new RegExp(`(^|[\\s{,])${required}[,:]`, "m").test(args),
        `the call is missing ${required}`,
      );
    }
  });

  it("the callers in the same family agree on the spelling", () => {
    const args = callArgs("vehicles-actions.ts", "admin_upsert_vehicle_type");
    assert.equal(/\bp_[a-z_]+[,:]/.test(args), false);
  });

  it("a duplicate key is its own error, not a malformed-key error", () => {
    const source = readFileSync(join(here, "vehicle-companies-actions.ts"), "utf8");
    assert.match(source, /error: "company_exists"/);
    assert.equal(
      /input\.isNew && beforeSnap\.exists\) return \{ error: "invalid_company_key" \}/.test(source),
      false,
      "a duplicate key is still reported as invalid_company_key",
    );
  });
});
