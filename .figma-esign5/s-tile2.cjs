module.exports = async ({ page, go, shot }) => {
  page.on('response', (r) => {
    if (r.status() >= 400) console.log('HTTP', r.status(), r.request().method(), r.url().replace('http://localhost:3000', ''));
  });
  await go('/en/requests/esign');
  console.log(
    'TILE HREFS',
    JSON.stringify(
      await page.evaluate(() =>
        [...document.querySelectorAll('main a')].map(
          (a) => `${a.innerText.split('\n')[0]} => ${a.getAttribute('href')}`,
        ),
      ),
      null,
      1,
    ),
  );
  await page.click('a:has-text("E-signatures")');
  await page.waitForTimeout(3000);
  console.log('AFTER CLICK', page.url().replace('http://localhost:3000', ''));
  await shot('ix-tile-esignatures');
};
