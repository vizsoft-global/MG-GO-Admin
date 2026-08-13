// Re-confirm VB/02 calendar, VB/05 slots, VB/06 departments, VB/08 reports.
module.exports = async ({ page, shot, go, overflow }) => {
  const screens = [
    ['/en/visit-bookings/calendar', 'vb02-calendar'],
    ['/en/visit-bookings/slots', 'vb05-slots'],
    ['/en/visit-bookings/departments', 'vb06-depts'],
    ['/en/visit-bookings/reports', 'vb08-reports'],
    ['/en/visit-bookings/branches', 'vb07-branches'],
  ];
  for (const [route, name] of screens) {
    await go(route);
    await shot(name);
    const o = await overflow();
    // every select trigger must show a human label, never a uuid or a raw enum
    const triggers = await page.locator('[data-slot="select-trigger"], button[role="combobox"]').allInnerTexts();
    console.log('SCREEN', name, JSON.stringify(o));
    console.log('  TRIGGERS', JSON.stringify(triggers.map((s) => s.replace(/\s+/g, ' ').trim())));
  }
};
