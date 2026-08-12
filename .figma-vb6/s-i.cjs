// VB/06 department save round-trip + VB/08 date range filter.
module.exports = async ({ page, shot, go }) => {
  await go('/en/visit-bookings/departments');
  await page.locator('button:has-text("Edit")').first().click();
  await page.waitForTimeout(1500);
  const handling = page.locator('[role="dialog"] input[type="number"]').first();
  console.log('HANDLING_BEFORE', JSON.stringify(await handling.inputValue()));
  await handling.fill('12');
  await page.locator('[role="dialog"] button:has-text("Save")').first().click();
  await page.waitForTimeout(4000);
  console.log('DEPT_TOAST', JSON.stringify((await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).map((s) => s.replace(/\s+/g, ' ').trim())));
  await page.waitForTimeout(1500);
  console.log('DEPT_ROW1', (await page.locator('tbody tr').first().innerText()).replace(/\s+/g, ' ').trim());
  await shot('ix-dept-saved');

  // ---- VB/08 date range
  await go('/en/visit-bookings/reports');
  const dateBtn = page.locator('button:has-text("All time")').first();
  if (await dateBtn.count()) {
    await dateBtn.click();
    await page.waitForTimeout(1000);
    const opts = await page.locator('[role="menuitem"], [role="option"], button').allInnerTexts();
    console.log('DATE_PRESETS', JSON.stringify(opts.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => /day|month|week|time|Today|Custom/i.test(s)).slice(0, 12)));
    await shot('ix-reports-dates');
    const preset = page.locator('text=/Last 30 days/i').first();
    if (await preset.count()) {
      await preset.click();
      await page.waitForTimeout(3000);
      console.log('AFTER_PRESET', (await page.locator('button:has-text("Last 30 days")').first().innerText().catch(() => '?')).trim());
      const kpi = await page.locator('main').nth(1).innerText();
      console.log('KPI', kpi.replace(/\s+/g, ' ').slice(0, 160));
    } else {
      console.log('no Last 30 days preset');
    }
    await shot('ix-reports-30d');
  } else {
    console.log('no date filter button found');
  }
};
