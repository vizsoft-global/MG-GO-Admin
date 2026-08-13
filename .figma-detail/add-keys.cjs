const fs = require("node:fs");
const path = require("node:path");

const ADDITIONS = {
  en: {
    status: { awaiting_ack: "Awaiting acknowledgement", acknowledged: "Acknowledged" },
    detail: { otherDetails: "Other details" },
  },
  ar: {
    status: { awaiting_ack: "بانتظار الإقرار", acknowledged: "تم الإقرار" },
    detail: { otherDetails: "تفاصيل أخرى" },
  },
};

for (const [locale, groups] of Object.entries(ADDITIONS)) {
  const file = path.join(__dirname, "..", "src", "messages", `${locale}.json`);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const requests = json.pages.requests;
  for (const [group, entries] of Object.entries(groups)) {
    requests[group] = requests[group] ?? {};
    for (const [key, value] of Object.entries(entries)) {
      requests[group][key] = value;
    }
  }
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  console.log(`${locale}: ok`);
}
