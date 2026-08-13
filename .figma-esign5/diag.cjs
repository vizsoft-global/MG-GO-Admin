// Standalone diagnostic: fresh (non-persistent) chromium, no login helper.
const { chromium } = require('C:/Users/Admin/.cursor/plugins/cache/cursor-public/browse/release_v0.2.4/node_modules/playwright-core');

(async () => {
  const browser = await chromium.launch({
    headless: process.env.QA_HEADED !== '1',
    args: ['--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  const step = require(require('path').resolve(process.argv[2]));
  try {
    await step({ page });
  } catch (e) {
    console.log('ERR', e.message);
  }
  await browser.close();
})();
