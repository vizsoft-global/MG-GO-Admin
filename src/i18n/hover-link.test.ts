import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

  it("does not let the sidebar go back to prefetching every menu page", () => {
    for (const file of ["../components/layout/app-sidebar.tsx", "../components/layout/app-secondary-nav.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.doesNotMatch(source, /<Link[^>]*\sprefetch(\s|>|=\{true\})/, file);
    }
  });
});
