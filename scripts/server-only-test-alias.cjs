// Test-only module alias for `server-only`.
//
// Why this exists
// ---------------
// `server-only` is a *bundler guard*, not a runtime dependency. Its `index.js`
// throws unconditionally:
//
//   Error: This module cannot be imported from a Client Component module.
//
// A bundler is expected to substitute the package's own no-op `empty.js` via the
// `react-server` export condition. Next.js does exactly that, which is why the
// two modules that import it (`src/features/notifications/dpd-shift-notices.ts`
// and `src/lib/auth/sync-admin-permissions.ts`) build and run correctly.
//
// `node --test` is not a bundler, so without this alias every suite that reaches
// those modules fails. Two things that do NOT work:
//
//   * Installing the package alone: resolution succeeds, `index.js` then throws.
//   * `--conditions react-server`: the flag is global, so React also resolves to
//     its server build and dies on `react.createContext is not a function`.
//
// tsx loads these modules as CommonJS (see the `Object.<anonymous>` frame in the
// stack trace), so an ESM `resolve` hook registered via `module.register()` is
// never consulted — and `module.registerHooks()` does not exist on Node 22.9.
// Patching CJS resolution is therefore the only mechanism that reaches the load
// path, and it is the same technique `module-alias` / `tsconfig-paths` use.
//
// This maps `server-only` -> the package's own `empty.js`, i.e. exactly the
// substitution the bundler performs. It is applied only by the test scripts and
// never by the application, so the guard still protects the real build.
const path = require("node:path");
const Module = require("node:module");

const SERVER_ONLY_EMPTY = path.join(
  path.dirname(require.resolve("server-only")),
  "empty.js",
);

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, ...rest) {
  if (request === "server-only") {
    return SERVER_ONLY_EMPTY;
  }

  return originalResolveFilename.call(this, request, ...rest);
};
