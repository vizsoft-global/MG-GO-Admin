import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * The rule is tested on its own: `hover-link.tsx` is a client component and
 * pulls in next-intl's navigation, which does not load under the test runner.
 */
function resolvePrefetch<T>(explicit: T | undefined, warm: boolean): T | null | false {
  if (explicit !== undefined) return explicit;
  return warm ? null : false;
}

describe("panel link prefetch", () => {
  it("prefetches nothing until the link is reached, then the framework default", () => {
    assert.equal(resolvePrefetch(undefined, false), false);
    assert.equal(resolvePrefetch(undefined, true), null);
  });

  it("keeps what a caller asked for", () => {
    assert.equal(resolvePrefetch(true, false), true);
    assert.equal(resolvePrefetch(false, true), false);
    assert.equal(resolvePrefetch(null, false), null);
  });

  it("is the rule the component ships, and every panel link goes through it", () => {
    const component = readFileSync(new URL("./hover-link.tsx", import.meta.url), "utf8");
    assert.match(component, /if \(explicit !== undefined\) return explicit;\s+return warm \? null : false;/);
    const navigation = readFileSync(new URL("./navigation.ts", import.meta.url), "utf8");
    assert.match(navigation, /export \{ Link \} from "\.\/hover-link";/);
  });

  it("leaves no panel file on next/link's default prefetch", () => {
    // The rider cards on Live Tracking V2 used next/link directly, so the list
    // rendered a rider profile for every card in view and the session check fell over.
    const allowed = new Set([
      "components/system/plain-link.tsx",
      "features/auth/login-form.tsx",
      "features/auth/signup-form.tsx",
      "features/auth/forgot-password-form.tsx",
    ]);
    const root = new URL("../", import.meta.url);
    const offenders: string[] = [];
    for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      const file = entry.replaceAll("\\", "/");
      if (!/\.tsx?$/.test(file) || file.endsWith(".test.ts") || allowed.has(file)) continue;
      if (/from "next\/link"/.test(readFileSync(new URL(file, root), "utf8"))) offenders.push(file);
    }
    assert.deepEqual(offenders, []);
    const plain = readFileSync(new URL("../components/system/plain-link.tsx", import.meta.url), "utf8");
    assert.match(plain, /\{ prefetch = false, \.\.\.rest \}/);
  });

  it("does not let the sidebar go back to prefetching every menu page", () => {
    for (const file of ["../components/layout/app-sidebar.tsx", "../components/layout/app-secondary-nav.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.doesNotMatch(source, /<Link[^>]*\sprefetch(\s|>|=\{true\})/, file);
    }
  });
});
