import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const v1Page = path.join(root, "src/app/[locale]/(dashboard)/requests/esign/drafts/page.tsx");
const v2Page = path.join(root, "src/app/[locale]/(dashboard)/employeedesk/esign/drafts/page.tsx");

describe("eSign drafts canonical route", () => {
  it("keeps the working list on /requests/esign/drafts", () => {
    assert.equal(existsSync(v1Page), true);
    assert.match(readFileSync(v1Page, "utf8"), /requirePermission\(locale, "requests\.manage"\)/);
  });

  it("does not invent a V2 twin that would fork the screen", () => {
    assert.equal(existsSync(v2Page), false);
  });

  it("points every hub tile at the working V1 route", () => {
    const v1Hub = readFileSync(path.join(root, "src/features/esign/esign-hub-shell.tsx"), "utf8");
    const v2Hub = readFileSync(
      path.join(root, "src/app/[locale]/(dashboard)/employeedesk/esign/page.tsx"),
      "utf8",
    );
    assert.match(v1Hub, /href: "\/requests\/esign\/drafts"/);
    assert.match(v2Hub, /href: "\/requests\/esign\/drafts"/);
    assert.doesNotMatch(v1Hub, /\/employeedesk\/esign\/drafts/);
    assert.doesNotMatch(v2Hub, /\/employeedesk\/esign\/drafts/);
  });
});
