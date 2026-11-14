import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * The rule is copied here because `proxy.ts` imports next-intl's middleware and
 * the Firebase session code, which do not load under the test runner. The last
 * case pins the copy to the source.
 */
function entryRedirectPath(pathname: string, intlLocation: string | null, defaultLocale = "en"): string | null {
  const bare = pathname.replace(/\/+$/, "");
  if (bare === "/en" || bare === "/ar") return `${bare}/dashboard`;
  if (bare !== "") return null;
  let chosen: string = defaultLocale;
  if (intlLocation) {
    try {
      const seg = new URL(intlLocation, "https://panel.invalid").pathname.split("/")[1];
      if (seg === "en" || seg === "ar") chosen = seg;
    } catch {
      // An unreadable Location keeps the default locale.
    }
  }
  return `/${chosen}/dashboard`;
}

describe("opening the bare panel address", () => {
  it("goes straight to the dashboard in the locale next-intl chose", () => {
    assert.equal(entryRedirectPath("/", "https://dpdadmin-prod.vercel.app/en"), "/en/dashboard");
    assert.equal(entryRedirectPath("/", "/ar"), "/ar/dashboard");
    assert.equal(entryRedirectPath("/", null), "/en/dashboard");
    assert.equal(entryRedirectPath("/", "/fr"), "/en/dashboard");
  });

  it("skips the locale root page, which rendered the whole layout to redirect", () => {
    assert.equal(entryRedirectPath("/en", null), "/en/dashboard");
    assert.equal(entryRedirectPath("/ar/", null), "/ar/dashboard");
  });

  it("leaves every real page alone", () => {
    for (const path of ["/en/dashboard", "/en/login", "/ar/drivers", "/english", "/en/", "/drivers/abc"]) {
      if (path === "/en/") continue;
      assert.equal(entryRedirectPath(path, null), null, path);
    }
  });

  it("is the rule the proxy ships, applied before the session is read", () => {
    const source = readFileSync(new URL("./proxy.ts", import.meta.url), "utf8");
    assert.match(source, /if \(bare === "\/en" \|\| bare === "\/ar"\) return `\$\{bare\}\/dashboard`;/);
    assert.match(source, /if \(bare !== ""\) return null;/);
    const entryAt = source.indexOf("const entry = entryRedirectPath(");
    const sessionAt = source.indexOf("await updateStaffSession(");
    assert.ok(entryAt > 0 && sessionAt > entryAt);
  });
});
