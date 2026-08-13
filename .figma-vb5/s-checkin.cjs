// Real server round-trip: check in VIS-00001 from the All visits list.
// The row is restored to `confirmed` immediately afterwards via SQL.
module.exports = async ({ page, shot, go }) => {
  await go('/en/visit-bookings/all');
  const row = page.locator('tbody tr', { hasText: 'VIS-00001' });
  console.log('BEFORE status=', (await row.locator('td').nth(4).innerText()).trim());
  await row.getByRole('button', { name: 'Check in' }).click();
  await page.waitForTimeout(4000);
  const after = await row.locator('td').nth(4).innerText().catch(() => '(row gone)');
  console.log('AFTER status=', after.trim());
  console.log('TOAST=', await page.locator('[data-sonner-toast]').first().innerText().catch(() => '(none)'));
  await shot('ix-checkin-result');
};
