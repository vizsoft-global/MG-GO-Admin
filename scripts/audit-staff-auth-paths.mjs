/**
 * One-off audit: which callables still use the cached `requireStaff` while they
 * write. Money / permission / account writers were switched to
 * `requireStaffFresh`; this lists what is left, so the remaining surface is a
 * number rather than a claim.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "functions/src/rpcs";
const fresh = [];
const cached = [];

for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
  const source = readFileSync(join(dir, file), "utf8");
  const parts = source.split(/export const (\w+) = (?:onCall|measureOnCall)\(/);
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i];
    const body = parts[i + 1] ?? "";
    const block = body.slice(0, body.indexOf("\nexport const "));
    if (block.includes("requireStaffFresh(")) fresh.push(`${file}:${name}`);
    else if (block.includes("requireStaff(")) cached.push(`${file}:${name}`);
  }
}

console.log(`fresh=${fresh.length} cached=${cached.length}`);
console.log("--- still on the cached path ---");
console.log(cached.join("\n"));
