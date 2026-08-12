import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Shell redirection wrote UTF-16 on Windows, which turned database.ts into a binary blob in
// git. Generating through Node keeps the file UTF-8 on every platform.
const PROJECT_ID = "eoksxkdssptgyqyywdju";

const TAIL = `
export type AppRole = Database["public"]["Enums"]["app_role"];
export type AdminApprovalStatus = Database["public"]["Enums"]["admin_approval_status"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
`;

// shell: true is required for npx.cmd on Windows; every argument here is a literal.
const generated = execSync(
  `npx supabase gen types typescript --project-id ${PROJECT_ID}`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
);

writeFileSync("src/types/database.ts", generated + TAIL, { encoding: "utf8" });
console.log(`src/types/database.ts written (${generated.length} chars)`);
