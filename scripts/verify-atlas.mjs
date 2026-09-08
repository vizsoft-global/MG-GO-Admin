/**
 * Asserts the deployed bundle carries an intact marker-atlas module.
 *
 * Next's SWC minifier once folded `+` between two template literals and shipped a
 * mangled sheet that left every rider as a bare disc. This checks the built
 * artifact rather than the source, because that is where the corruption happened.
 *
 * Usage: node scripts/verify-atlas.mjs [origin]
 */

const origin = process.argv[2] ?? "https://dpdadmin-prod.vercel.app";

const html = await fetch(`${origin}/en/live-tracking-v2`, { redirect: "manual" }).then((r) =>
  r.text(),
);
const chunks = [...new Set([...html.matchAll(/\/_next\/static\/[^"']+?\.js/g)].map((m) => m[0]))];

let checked = 0;
let failed = 0;

for (const path of chunks) {
  const body = await fetch(`${origin}${path}`).then((r) => (r.ok ? r.text() : ""));
  if (!body.includes("fleet marker atlas")) continue;
  checked += 1;
  const checks = [
    ["per-cell bike compose present", body.includes("scratch 2d context unavailable")],
    ["ring cell not mangled", !body.includes('cy="24<circle')],
    ["blank-cell guard present", body.includes("blank sprite cells")],
  ];
  console.log(`${path}`);
  for (const [label, ok] of checks) {
    if (!ok) failed += 1;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  }
}

if (checked === 0) {
  console.error("no chunk carrying the atlas was reachable");
  process.exit(1);
}
process.exit(failed === 0 ? 0 : 1);
