// Interaction sweep: filters, tabs, modals, and one real mutation that is rolled back.
module.exports = async ({ page, shot, go, overflow }) => {
  const text = async (sel) => (await page.locator(sel).first().innerText().catch(() => '(none)'));

  // ---------- VB/01 all visits ----------
  await go('/en/visit-bookings/all');
  const triggers = page.locator('[data-slot="select-trigger"]');
  const n = await triggers.count();
  const labels = [];
  for (let i = 0; i < n; i += 1) labels.push((await triggers.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  console.log('ALL/select-triggers', JSON.stringify(labels));

  // status filter -> completed (expect 0 rows + empty state)
  await triggers.nth(2).click();
  await page.waitForTimeout(500);
  await page.getByRole('option', { name: 'Completed', exact: true }).click();
  await page.waitForTimeout(900);
  console.log('ALL/after-status-completed trigger=', (await triggers.nth(2).innerText()).trim(),
    ' rows=', await page.locator('tbody tr').count());
  await shot('ix-all-status-filter');
  // back to all
  await triggers.nth(2).click();
  await page.waitForTimeout(400);
  await page.getByRole('option', { name: 'All statuses' }).click();
  await page.waitForTimeout(700);

  // tabs
  for (const tab of ['Today', 'Upcoming', 'Past', 'All']) {
    await page.getByRole('button', { name: new RegExp(`^${tab}\\s`) }).first().click().catch(() => {});
    await page.waitForTimeout(500);
  }
  console.log('ALL/tabs-ok rows=', await page.locator('tbody tr').count());
  await shot('vb01-all');
  console.log('OVERFLOW vb01-all', JSON.stringify(await overflow()));

  // search
  await page.fill('input[placeholder*="Search"]', 'VIS-00002');
  await page.waitForTimeout(800);
  console.log('ALL/search rows=', await page.locator('tbody tr').count());
  await page.fill('input[placeholder*="Search"]', '');
  await page.waitForTimeout(500);

  // ---------- VB/02 calendar ----------
  await go('/en/visit-bookings/calendar');
  console.log('CAL/branch-trigger=', (await text('[data-slot="select-trigger"]')).replace(/\s+/g, ' ').trim());
  await page.getByRole('button', { name: 'Week' }).click();
  await page.waitForTimeout(1500);
  await shot('ix-cal-week');
  console.log('OVERFLOW cal-week', JSON.stringify(await overflow()));
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Today' }).click();
  await page.waitForTimeout(1500);
  await shot('vb02-calendar');
  console.log('OVERFLOW vb02-calendar', JSON.stringify(await overflow()));

  // ---------- VB/05 slots ----------
  await go('/en/visit-bookings/slots');
  const st = page.locator('[data-slot="select-trigger"]');
  const sn = await st.count();
  const sl = [];
  for (let i = 0; i < sn; i += 1) sl.push((await st.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  console.log('SLOTS/select-triggers', JSON.stringify(sl));
  await shot('vb05-slots');
  console.log('OVERFLOW vb05-slots', JSON.stringify(await overflow()));
  // open the blocked-date modal (no save)
  await page.getByRole('button', { name: 'Add blocked date' }).click();
  await page.waitForTimeout(900);
  await shot('ix-slots-blocked-modal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ---------- VB/06 departments ----------
  await go('/en/visit-bookings/departments');
  await shot('vb06-depts');
  console.log('OVERFLOW vb06-depts', JSON.stringify(await overflow()));
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.waitForTimeout(900);
  await shot('ix-dept-edit-modal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ---------- VB/07 branches ----------
  await go('/en/visit-bookings/branches');
  await shot('vb07-branches');
  console.log('BRANCH/desks-cell=', (await page.locator('tbody tr td').nth(3).innerText()).trim());
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.waitForTimeout(900);
  await shot('ix-branch-edit-modal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ---------- VB/08 reports ----------
  await go('/en/visit-bookings/reports');
  const rt = page.locator('[data-slot="select-trigger"]');
  const rn = await rt.count();
  const rl = [];
  for (let i = 0; i < rn; i += 1) rl.push((await rt.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  console.log('REPORTS/select-triggers', JSON.stringify(rl));
  const bars = await page.evaluate(() =>
    [...document.querySelectorAll('div[title*="W"]')].map((b) => Math.round(b.getBoundingClientRect().height)),
  );
  console.log('REPORTS/bar-heights', JSON.stringify(bars));
  await shot('vb08-reports');
  console.log('OVERFLOW vb08-reports', JSON.stringify(await overflow()));

  // ---------- hub ----------
  await go('/en/visit-bookings');
  await shot('vb00-hub');
};
