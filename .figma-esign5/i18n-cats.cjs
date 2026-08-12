// Throwaway: add only the esign category column keys, preserving concurrent agents' edits.
const fs = require('fs');

const ADD = {
  en: { colCategory: 'Category', colScreenshots: 'Screenshots', colActive: 'Active' },
  ar: { colCategory: 'الفئة', colScreenshots: 'لقطات الشاشة', colActive: 'نشط' },
};

for (const locale of ['en', 'ar']) {
  const file = `src/messages/${locale}.json`;
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cats = json.pages.requests.esign.categories;
  for (const [k, v] of Object.entries(ADD[locale])) cats[k] = v;
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(locale, 'ok');
}
