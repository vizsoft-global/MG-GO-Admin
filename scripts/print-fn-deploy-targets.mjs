/**
 * One-off: print the `--only` target list for a partial functions deploy.
 *
 * A full `firebase deploy --only functions` from this branch aborts (and with
 * `--force` would delete) four `*BitesMirror*` / `bites*` functions that exist in
 * the production project but have no source on this branch. Listing only the
 * functions this branch owns deploys the code without touching them.
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { LEGACY_MODULES } = require("../functions/lib/router/legacy-modules.js");

const names = [
  ...Object.values(LEGACY_MODULES).flat(),
  "adminApi",
  "adminApiScan",
  "adminApiHeavy",
];
const only = names.map((name) => `functions:${name}`).join(",");
writeFileSync(".tmp_fn_targets.txt", only, "utf8");
console.log(`targets=${names.length} bytes=${only.length}`);
