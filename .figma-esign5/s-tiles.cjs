module.exports = async ({ page, go, shot }) => {
  const tiles = [
    'New request',
    'Sent requests',
    'E-signatures',
    'Signature categories',
    'Admin calendar',
    'E-Signature settings',
  ];
  for (const label of tiles) {
    await go('/en/requests/esign');
    await page.click(`text=${label}`);
    await page.waitForTimeout(2500);
    const modal = await page.locator('[role="dialog"]').count();
    console.log(`TILE "${label}" -> ${page.url().replace('http://localhost:3000', '')} modal=${modal}`);
    if (label === 'New request') await shot('ix-hub-new-request');
  }
  // Refresh button round-trip on the sent list
  await go('/en/requests/esign/sent');
  const posts = [];
  page.on('request', (r) => r.method() === 'POST' && posts.push(1));
  await page.click('button:has-text("Refresh")');
  await page.waitForTimeout(2500);
  console.log('REFRESH posts=', posts.length, 'rows=', await page.locator('tbody tr').count());
};
