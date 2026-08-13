const fs = require("fs");

const files = [
  "visits-page-shell.tsx",
  "visits-departments-shell.tsx",
  "visits-branches-shell.tsx",
  "visit-detail-page-shell.tsx",
  "visits-reports-shell.tsx",
  "visits-reception-shell.tsx",
];

for (const f of files) {
  const p = "src/features/visits/" + f;
  const before = fs.readFileSync(p, "utf8");
  let s = before.replace(/import \{ VisitsTabBar \} from "\.\/visits-tab-bar";\r?\n/g, "");
  s = s.replace(/\r?\n\s*<VisitsTabBar \/>\r?\n/g, "\n");
  fs.writeFileSync(p, s);
  console.log(f, before === s ? "UNCHANGED" : "ok");
}
