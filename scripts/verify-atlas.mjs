/**
 * Asserts the deployed bundle carries an intact marker-atlas SVG.
 *
 * The selection-ring cell was shipped mangled by SWC's folding of `+` between two
 * template literals, which invalidated the whole sheet and left every rider as a bare
 * status puck. This checks the built artifact rather than the source, because that is
 * where the corruption happened.
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
    ["ring outer stroke present", body.includes('stroke="#ffffff" stroke-width="5"')],
    ["ring opacity present", body.includes('stroke-opacity="0.9"')],
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
