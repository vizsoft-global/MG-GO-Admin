module.exports = async ({ page }) => {
  const base = process.env.QA_BASE || 'http://localhost:3000';
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE[error]', m.text().slice(0, 140));
  });
  await page.goto(`${base}/en/login`, { waitUntil: 'load', timeout: 180000 });
  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(3000);
    const react = await page.evaluate(() =>
      Object.keys(document).filter((k) => k.startsWith('__react')),
    );
    console.log(`t=${(i + 1) * 3}s react=${JSON.stringify(react)}`);
    if (react.length) break;
  }
};
