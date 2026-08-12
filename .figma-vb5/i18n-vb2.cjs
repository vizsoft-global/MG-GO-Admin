const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const PATCH = {
  en: { 'slots.ridersValue': '{count, plural, one {# rider} other {# riders}}' },
  ar: { 'slots.ridersValue': '{count, plural, one {سائق واحد} other {# سائقين}}' },
};

for (const [locale, patch] of Object.entries(PATCH)) {
  const file = path.join(ROOT, 'src', 'messages', `${locale}.json`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const base = json.pages.visitBookings;
  for (const [dotted, value] of Object.entries(patch)) {
    const [group, key] = dotted.split('.');
    base[group] = base[group] || {};
    base[group][key] = value;
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log('patched', locale);
}
