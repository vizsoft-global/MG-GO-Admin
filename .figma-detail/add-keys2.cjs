const fs = require("node:fs");
const path = require("node:path");

const ADDITIONS = {
  en: { ackDone: "The worker acknowledged these terms in the app." },
  ar: { ackDone: "أقرّ العامل بهذه الشروط في التطبيق." },
};

for (const [locale, entries] of Object.entries(ADDITIONS)) {
  const file = path.join(__dirname, "..", "src", "messages", `${locale}.json`);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const terms = json.pages.requests.detail.terms;
  for (const [key, value] of Object.entries(entries)) terms[key] = value;
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  console.log(`${locale}: ok`);
}
