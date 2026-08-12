module.exports = async ({ page, go, shot }) => {
  await go('/en/requests/esign/categories');
  const row = page.locator('tbody tr', { hasText: 'Other' }).last();
  const sw = row.locator('input[type=checkbox]').first();
  const read = async () => ({
    label: (await row.locator('td').nth(3).innerText()).trim(),
    checked: await sw.isChecked(),
  });
  const cell = row.locator('td').nth(3);
  console.log('BEFORE', JSON.stringify(await read()));
  await cell.click({ position: { x: 10, y: 12 } });
  await page.waitForTimeout(4000);
  console.log('AFTER TOGGLE', JSON.stringify(await read()));
  await shot('ix-cat-toggled');
  // revert so production data is left exactly as found
  await cell.click({ position: { x: 10, y: 12 } });
  await page.waitForTimeout(4000);
  console.log('REVERTED', JSON.stringify(await read()));
};
