module.exports = async ({ page }) => {
  const failed = [];
  page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 120)}`));
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
  });
  page.on('console', (m) => console.log(`CONSOLE[${m.type()}]`, m.text().slice(0, 200)));

  await page.goto('http://127.0.0.1:3000/en/login', { waitUntil: 'load', timeout: 180000 });
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(5000);
    const st = await page.evaluate(() => ({
      react: Object.keys(document).filter((k) => k.startsWith('__react')),
      chunks: performance.getEntriesByType('resource').filter((e) => e.name.includes('.js')).length,
      pending: performance.getEntriesByType('resource').filter((e) => e.responseEnd === 0).length,
    }));
    console.log(`t=${(i + 1) * 5}s react=${JSON.stringify(st.react)} jsRes=${st.chunks} pending=${st.pending}`);
    if (st.react.length) break;
  }
  console.log('FAILED REQUESTS:\n' + [...new Set(failed)].slice(0, 30).join('\n'));
};
