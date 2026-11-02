/**
 * A Manager's permission set must never be narrower than the code catalog.
 *
 * The regression this pins: `admin_permissions/catalog` carried 161 slugs while
 * `permission-catalog.ts` shipped 172, so thirteen slugs — `service.*`, the seven
 * `payroll.*` tab slugs, `compliance.*` and `drivers.bank_view` — were denied to
 * every Full access (`access_kind: "manager"`) session. `/fleet/service`
 * redirected to `/unauthorized` and the Payroll tabs disappeared, while a User
 * with an explicit tick still opened them and a super admin bypassed the check.
 *
 * The panel fix is `catalogWithCodeSlugs`, which unions the code catalog into
 * every manager read. These cases fail if that union is dropped, or if a manager
 * path ever goes back to trusting the stored document alone.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CATALOG_SLUGS } from "./permission-catalog";
import { catalogWithCodeSlugs } from "./profile-auth";

const here = dirname(fileURLToPath(import.meta.url));

test("a stored catalog that is behind the code still grants every code slug", () => {
  const stored = ["drivers.view", "payroll.manage"];
  const merged = catalogWithCodeSlugs(stored);

  for (const slug of CATALOG_SLUGS) {
    assert.ok(merged.includes(slug), `${slug} is missing from a manager's set`);
  }
  assert.ok(merged.includes("service.view"), "Fleet Service must reach a manager");
  assert.ok(merged.includes("payroll.hr_payroll"), "HR Payroll tab must reach a manager");
});

test("extra slugs already on the document are kept", () => {
  const merged = catalogWithCodeSlugs(["drivers.create", "legacy.only"]);
  assert.ok(merged.includes("legacy.only"), "a doc-only slug must survive the union");
  assert.ok(merged.includes("drivers.create"));
});

test("an empty or absent document still yields the whole catalog", () => {
  const merged = catalogWithCodeSlugs([]);
  assert.equal(merged.length, CATALOG_SLUGS.length);
});

test("the manager read path unions the code catalog", () => {
  const source = readFileSync(join(here, "profile-auth.ts"), "utf8");
  // Every read of the catalog document must pass through the union. A bare
  // `slugsFrom(...) ?? [...]` return is the shape that shipped the bug.
  assert.match(source, /catalogWithCodeSlugs\(/);
  const bareReturns = source
    .split("\n")
    .filter((line) => /return\s+slugsFrom\(/.test(line) || /=\s*slugsFrom\([^)]*\)\s*\?\?/.test(line));
  assert.deepEqual(bareReturns, [], "a catalog read bypasses catalogWithCodeSlugs");
});
