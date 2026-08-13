// VB/01 interactions: filters round-trip + actions column fit.
module.exports = async ({ page, shot, go, overflow }) => {
  await go('/en/visit-bookings/all');
  await shot('vb01-all');
  console.log('OVERFLOW', JSON.stringify(await overflow()));

  // does the table overflow its card horizontally?
  const fit = await page.evaluate(() => {
    const wrap = document.querySelector('div.overflow-x-auto');
    const table = wrap?.querySelector('table');
    return wrap && table
      ? { wrapW: wrap.clientWidth, tableW: table.scrollWidth, clipped: table.scrollWidth > wrap.clientWidth + 1 }
      : 'no-table';
  });
  console.log('TABLE_FIT', JSON.stringify(fit));

  // tabs
  for (const label of ['Today', 'Upcoming', 'Past', 'All']) {
    const btn = page.locator(`button:has-text("${label}")`).first();
    await btn.click();
    await page.waitForTimeout(700);
    const rows = await page.locator('tbody tr').count();
    console.log('TAB', label, 'rows=', rows);
  }

  // status filter select
  const triggers = page.locator('button[role="combobox"], [data-slot="select-trigger"]');
  const n = await triggers.count();
  console.log('SELECT_TRIGGERS', n);
  const labels = [];
  for (let i = 0; i < n; i++) labels.push((await triggers.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  console.log('TRIGGER_LABELS', JSON.stringify(labels));

  // open the status one (3rd) and pick Cancelled -> expect 0 rows
  await triggers.nth(2).click();
  await page.waitForTimeout(600);
  await shot('ix-all-status-open');
  const opts = await page.locator('[role="option"]').allInnerTexts();
  console.log('STATUS_OPTIONS', JSON.stringify(opts.map((s) => s.trim())));
  await page.locator('[role="option"]:has-text("Cancelled")').first().click();
  await page.waitForTimeout(900);
  console.log('AFTER_CANCELLED rows=', await page.locator('tbody tr').count());
  console.log('COUNT_LABEL', (await page.locator('text=/\\d+ of \\d+/').first().innerText().catch(() => '?')).trim());
  await shot('ix-all-status-cancelled');

  // reset to confirmed to prove server data drives it
  await triggers.nth(2).click();
  await page.waitForTimeout(500);
  await page.locator('[role="option"]:has-text("Confirmed")').first().click();
  await page.waitForTimeout(800);
  console.log('AFTER_CONFIRMED rows=', await page.locator('tbody tr').count());

  // search
  await page.fill('input[placeholder*="Search"]', 'VIS-00002');
  await page.waitForTimeout(800);
  console.log('AFTER_SEARCH rows=', await page.locator('tbody tr').count());
  await shot('ix-all-search');
};
