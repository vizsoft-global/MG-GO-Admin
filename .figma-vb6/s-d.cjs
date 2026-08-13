// VB/01 write round-trip: check in VIS-00001 from the list.
module.exports = async ({ page, shot, go }) => {
  await go('/en/visit-bookings/all');
  const row = page.locator('tbody tr', { hasText: 'VIS-00001' }).first();
  console.log('ROW_BEFORE', (await row.innerText()).replace(/\s+/g, ' ').trim());
  await row.locator('button[title="Check in"]').click();
  await page.waitForTimeout(4000);
  const toast = await page.locator('[data-sonner-toast], [role="status"]').allInnerTexts().catch(() => []);
  console.log('TOAST', JSON.stringify(toast.map((s) => s.replace(/\s+/g, ' ').trim())));
  await page.waitForTimeout(1500);
  const rowAfter = page.locator('tbody tr', { hasText: 'VIS-00001' }).first();
  console.log('ROW_AFTER', (await rowAfter.innerText()).replace(/\s+/g, ' ').trim());
  await shot('ix-all-checkin');
};
