// Throwaway: e-sign detail timeline keys (Figma "Viewed" step), both locales.
const fs = require('fs');

const ADD = {
  en: { timelineViewed: 'Viewed', timelineViewedGap: 'Not tracked yet' },
  ar: { timelineViewed: 'تمت المشاهدة', timelineViewedGap: 'غير متتبَّع بعد' },
};

for (const locale of ['en', 'ar']) {
  const file = `src/messages/${locale}.json`;
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const detail = json.pages.requests.esign.detail;
  for (const [k, v] of Object.entries(ADD[locale])) detail[k] = v;
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(locale, 'ok');
}
