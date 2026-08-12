// VB/02 calendar: wait for the grid, capture toolbar, day/week + date stepper.
module.exports = async ({ page, shot, go, overflow }) => {
  await go('/en/visit-bookings/calendar');
  await page.waitForTimeout(6000);
  await shot('vb02-calendar');
  console.log('OVERFLOW', JSON.stringify(await overflow()));

  const toolbar = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    const txt = main.innerText.replace(/\s+/g, ' ').trim();
    const triggers = [...main.querySelectorAll('[data-slot="select-trigger"], button[role="combobox"]')].map((b) => b.innerText.trim());
    const heads = [...main.querySelectorAll('th')].map((h) => h.innerText.replace(/\s+/g, ' ').trim());
    return { first: txt.slice(0, 320), triggers, heads };
  });
  console.log('TOOLBAR', JSON.stringify(toolbar));

  // week view
  await page.locator('button:has-text("Week")').first().click();
  await page.waitForTimeout(3500);
  await shot('ix-cal-week');
  console.log('WEEK_OVERFLOW', JSON.stringify(await overflow()));
  console.log('WEEK_HEADS', JSON.stringify(await page.locator('th').allInnerTexts().catch(() => [])));

  // back to day + step a date
  await page.locator('button:has-text("Day")').first().click();
  await page.waitForTimeout(2500);
  const label = await page.locator('button:has-text("Today")').first();
  const before = (await page.locator('main').innerText()).slice(0, 60).replace(/\s+/g, ' ');
  await page.locator('button:has-text("Today")').first().click();
  await page.waitForTimeout(2500);
  console.log('DATE_BEFORE', before);
  console.log('DATE_AFTER', (await page.locator('main').innerText()).slice(0, 60).replace(/\s+/g, ' '));
  await shot('ix-cal-day');
};
