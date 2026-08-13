// Throwaway: merge only the Visit Booking keys into en.json / ar.json without
// reformatting or clobbering keys another agent may have added concurrently.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const PATCH = {
  en: {
    'allVisits.colVisId': 'VIS ID',
    'branches.subtitle': 'Manage visit locations. Every booking, slot rule and desk belongs to a branch.',
    'branches.desksValue': '{count, plural, one {# desk} other {# desks}}',
    'departments.pageTitle': 'Departments & desks',
    'departments.pageSubtitle':
      "Manage each department's reception desk, assigned staff and availability",
    'departments.countLabel': '{count, plural, one {# department} other {# departments}}',
    'reports.pageTitle': 'Reports & analytics',
    'reports.newSubtitle': 'Visit volume, no-show rate and department performance by branch',
    'reports.filterBranchAll': 'Branch: All branches',
    'reports.filterBranchValue': 'Branch: {name}',
    'reports.weekBarTitle': '{week} · {count} visits',
  },
  ar: {
    'allVisits.colVisId': 'رقم الزيارة',
    'branches.subtitle': 'إدارة مواقع الزيارات. كل حجز وقاعدة موعد ومكتب ينتمي إلى فرع.',
    'branches.desksValue': '{count, plural, one {مكتب واحد} other {# مكاتب}}',
    'departments.pageTitle': 'الأقسام والمكاتب',
    'departments.pageSubtitle': 'إدارة مكتب الاستقبال والموظف المسؤول والإتاحة لكل قسم',
    'departments.countLabel': '{count, plural, one {قسم واحد} other {# أقسام}}',
    'reports.pageTitle': 'التقارير والتحليلات',
    'reports.newSubtitle': 'حجم الزيارات ونسبة عدم الحضور وأداء الأقسام حسب الفرع',
    'reports.filterBranchAll': 'الفرع: كل الفروع',
    'reports.filterBranchValue': 'الفرع: {name}',
    'reports.weekBarTitle': '{week} · {count} زيارة',
  },
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
  console.log('patched', locale, Object.keys(patch).length, 'keys');
}
