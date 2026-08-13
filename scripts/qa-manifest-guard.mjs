/**
 * Keeps .next/dev/prerender-manifest.json parseable while several browsers hit the
 * dev server at once.
 *
 * Next 16 dev rewrites that manifest non-atomically as routes compile. Under
 * concurrent first-compiles the write can land twice, leaving trailing bytes after
 * the JSON value ("Unexpected non-whitespace character after JSON"), and then every
 * request 500s until the next clean write. This truncates the duplicated tail so the
 * QA pass is not blocked.
 *
 *   node scripts/qa-manifest-guard.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FILE = ".next/dev/prerender-manifest.json";
const INTERVAL_MS = 750;
let repairs = 0;

const repair = () => {
  if (!existsSync(FILE)) return;
  let raw;
  try {
    raw = readFileSync(FILE, "utf8");
  } catch {
    return;
  }
  try {
    JSON.parse(raw);
    return;
  } catch (error) {
    const at = /position (\d+)/.exec(String(error.message));
    if (!at) return;
    try {
      const value = JSON.parse(raw.slice(0, Number(at[1])));
      writeFileSync(FILE, JSON.stringify(value));
      repairs += 1;
      console.log(`[${new Date().toISOString()}] repaired prerender-manifest (#${repairs})`);
    } catch {
      // Mid-write snapshot: leave it, the next tick sees the finished file.
    }
  }
};

console.log("guarding .next/dev/prerender-manifest.json");
setInterval(repair, INTERVAL_MS);
repair();
