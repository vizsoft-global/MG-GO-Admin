/**
 * Message catalogue guard.
 *
 * Fails when a component asks for a message that does not exist, or asks for a
 * group where a string is expected. Both render the raw key path in the UI with
 * no error and no warning — the Settings ? Companies page and the whole Arabic
 * Attendance module each shipped that way — so the only place this can be caught
 * cheaply is a check like this one.
 *
 *   node scripts/check-messages.mjs        # all locales in src/messages
 *
 * Notes on what is deliberately NOT flagged:
 *  - A file that never calls `useTranslations`/`getTranslations` receives `t` as a
 *    parameter (formatters in `src/features/dpd/types.ts`, for example). Which
 *    namespace that `t` closes over is decided by the caller, so the key cannot be
 *    resolved here and guessing would produce false positives.
 *  - `t(\`...\`)` with an interpolation is skipped: the key is only knowable at
 *    runtime.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const MESSAGES = join(SRC, "messages");

const LOCALES = readdirSync(MESSAGES)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.replace(/\.json$/, ""))
  .sort();

/** Flatten a message tree into "a.b.c" -> value, and record every group path. */
function flatten(node, prefix = "", values = new Map(), groups = new Set()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      groups.add(path);
      flatten(value, path, values, groups);
    } else {
      values.set(path, value);
    }
  }
  return { values, groups };
}

function collectSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "messages" || entry === "node_modules") continue;
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const catalogs = new Map();
for (const locale of LOCALES) {
  const raw = readFileSync(join(MESSAGES, `${locale}.json`), "utf8");
  catalogs.set(locale, flatten(JSON.parse(raw.replace(/^\uFEFF/, ""))));
}

const problems = [];

for (const file of collectSourceFiles(SRC)) {
  const source = readFileSync(file, "utf8");

  const namespaces = new Set();
  for (const match of source.matchAll(
    /(?:useTranslations|getTranslations)\s*\(\s*(["'`])([\w.\-]*(?:\.[\w.\-]+)*)\1\s*\)/g,
  )) {
    namespaces.add(match[2]);
  }
  if (namespaces.size === 0) continue;

  const relativeFile = relative(ROOT, file).replace(/\\/g, "/");

  for (const match of source.matchAll(/\bt\s*\(\s*(["'`])([^"'`$]+)\1/g)) {
    const key = match[2];
    if (!key) continue;
    const line = source.slice(0, match.index).split("\n").length;
    const candidates = [...namespaces].map((ns) => (ns ? `${ns}.${key}` : key));
    const usages = [...namespaces].join(", ") || "(root)";

    for (const locale of LOCALES) {
      const { values, groups } = catalogs.get(locale);
      if (candidates.some((candidate) => values.has(candidate))) continue;
      if (values.has(key)) continue;

      const group = candidates.find((candidate) => groups.has(candidate));
      problems.push({
        locale,
        file: relativeFile,
        line,
        key,
        usages,
        reason: group
          ? `"${group}" is a group, not a message — t() returns an object`
          : "missing",
      });
    }
  }
}

if (problems.length === 0) {
  console.log(`messages OK — ${LOCALES.length} locales, ${catalogs.get(LOCALES[0]).values.size} keys each`);
  process.exit(0);
}

console.error(`${problems.length} problem(s):\n`);
for (const problem of problems) {
  console.error(`  [${problem.locale}] ${problem.file}:${problem.line}  ${problem.key}`);
  console.error(`      namespace: ${problem.usages}`);
  console.error(`      ${problem.reason}\n`);
}
process.exit(1);
