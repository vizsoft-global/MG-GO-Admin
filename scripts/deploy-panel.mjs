/**
 * Panel deploy, with the dxb1 region handled honestly.
 *
 * `vercel --prod` has been failing with *The region "dxb1" is currently
 * unavailable. Please select a different region for your deployment.* — there is
 * no public Vercel incident, and a preview build in `iad1` succeeds, so the
 * block is specific to the Dubai region.
 *
 * The region is not cosmetic here: every admin data call is made from a server
 * action (`callAdminFunction` → `me-central1`), so moving the deployment off
 * `dxb1` would add roughly +150 ms to each one. This script therefore retries
 * `dxb1` and refuses to silently switch region; it prints both options instead.
 *
 *   node scripts/deploy-panel.mjs            # retry dxb1 a few times
 *   node scripts/deploy-panel.mjs --attempts 2 --wait 60
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const attempts = flag("attempts", 3);
const waitSeconds = flag("wait", 45);

function deploy() {
  const result = spawnSync("npx", ["vercel", "--prod", "--yes"], {
    encoding: "utf8",
    shell: true,
    timeout: 30 * 60 * 1000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { ok: result.status === 0, output };
}

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  console.log(`\n[panel] attempt ${attempt}/${attempts} — target region dxb1`);
  const { ok, output } = deploy();
  const tail = output.trim().split("\n").slice(-6).join("\n");
  console.log(tail);

  if (ok) {
    console.log("\n[panel] deployed to production on dxb1.");
    process.exit(0);
  }

  const regionBlocked = /region "dxb1" is currently unavailable/i.test(output);
  if (!regionBlocked) {
    console.error("\n[panel] deploy failed for a reason other than the region. Read the output above.");
    process.exit(1);
  }

  if (attempt < attempts) {
    console.log(`[panel] dxb1 still unavailable — waiting ${waitSeconds}s`);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  }
}

console.log(`
[panel] dxb1 is still unavailable after ${attempts} attempts. Nothing was shipped.
Three options:

  1. Wait and re-run this command. There is no public Vercel incident, so it can
     clear at any time, and this script is safe to run repeatedly.

  2. Ship on the nearest region that does accept deployments, which is what
     \`vercel.json\` currently does:
       "regions": ["bom1"]
     Change nothing and this script deploys to Mumbai.

  3. Use both regions once Dubai is back:
       "regions": ["bom1", "dxb1"]
     then re-run this script. Vercel rejects the *whole* deployment if any
     region in the list is unavailable, so the list has to wait for dxb1 — it
     cannot be left as both while Dubai is down.

Every admin data call is made from a Vercel server action to the Firebase lanes
in me-central1, so the region is a latency multiplier for the whole panel:
bom1 (Mumbai) is the closest region currently accepting, and dxb1 (Dubai) is the
one to add back.
`);
process.exit(2);
