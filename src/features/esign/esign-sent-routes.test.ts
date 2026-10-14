import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

describe("eSign sent routes", () => {
  it("keeps Sent for signature on /employeedesk/esign/batches", () => {
    const page = path.join(
      root,
      "src/app/[locale]/(dashboard)/employeedesk/esign/batches/page.tsx",
    );
    assert.equal(existsSync(page), true);
    assert.match(readFileSync(page, "utf8"), /EsignBatchesShell/);
  });

  it("redirects the V1 batches list onto the EmployeeDesk tracker", () => {
    const page = readFileSync(
      path.join(root, "src/app/[locale]/(dashboard)/requests/esign/batches/page.tsx"),
      "utf8",
    );
    assert.match(page, /\/employeedesk\/esign\/batches/);
    assert.doesNotMatch(page, /EsignBatchesShell/);
  });

  it("redirects both Sent requests doors onto the batches page", () => {
    const v2 = readFileSync(
      path.join(root, "src/app/[locale]/(dashboard)/employeedesk/esign/sent/page.tsx"),
      "utf8",
    );
    const v1 = readFileSync(
      path.join(root, "src/app/[locale]/(dashboard)/requests/esign/sent/page.tsx"),
      "utf8",
    );
    assert.match(v2, /\/employeedesk\/esign\/batches\?scope=individual/);
    assert.match(v1, /\/employeedesk\/esign\/batches\?scope=individual/);
    assert.doesNotMatch(v2, /EsignSentShell/);
    assert.doesNotMatch(v1, /EsignSentShell/);
  });

  it("drops the extra Sent requests card from the EmployeeDesk eSign hub", () => {
    const hub = readFileSync(
      path.join(root, "src/app/[locale]/(dashboard)/employeedesk/esign/page.tsx"),
      "utf8",
    );
    assert.doesNotMatch(hub, /href: "\/employeedesk\/esign\/sent"/);
    assert.match(hub, /href: "\/employeedesk\/esign\/batches"/);
  });
});
