// Throwaway QA driver: persistent-session Chromium at 1366x768.
// usage: node .figma-vb5/drive.cjs <stepModule.cjs>
const path = require('path');
const { chromium } = require('C:/Users/Admin/.cursor/plugins/cache/cursor-public/browse/release_v0.2.4/node_modules/playwright-core');

const USER_DIR = path.join(__dirname, 'userdata');
const BASE = 'http://localhost:3000';

async function ensureLogin(page) {
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(90000);
  await page.goto(`${BASE}/en/visit-bookings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (!page.url().includes('/login')) return;
  await page.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.fill('input[type="email"], input[name="email"]', 'admin@vizsoft.in');
  await page.fill('input[type="password"], input[name="password"]', 'umc#1S#rR$yh616');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(6000);
  console.log('LOGIN ->', page.url());
}

(async () => {
  const stepFile = process.argv[2];
  const ctx = await chromium.launchPersistentContext(USER_DIR, {
    headless: true,
    viewport: { width: 1366, height: 768 },
    args: ['--disable-dev-shm-usage'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));

  const shot = async (name, opts = {}) => {
    await page.screenshot({ path: path.join(__dirname, `${name}.png`), fullPage: !!opts.full });
    console.log('SHOT', name, opts.full ? '(full)' : '(viewport)');
  };
  const go = async (url) => {
    await page.goto(url.startsWith('http') ? url : BASE + url, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForLoadState('networkidle', { timeout: 25000 });
    } catch {}
    await page.waitForTimeout(2500);
    console.log('AT', page.url());
  };
  // does the main scroll container overflow the viewport?
  const overflow = async () => {
    return page.evaluate(() => {
      const d = document.documentElement;
      const inner = [...document.querySelectorAll('*')]
        .filter((el) => {
          const s = getComputedStyle(el);
          return (
            (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
            el.scrollHeight - el.clientHeight > 8 &&
            el.clientHeight > 120
          );
        })
        .map((el) => `${el.tagName}.${(el.className || '').toString().slice(0, 90)} ${el.scrollHeight}/${el.clientHeight}`);
        return { doc: `${d.scrollHeight}/${window.innerHeight}`, innerScrollers: inner.slice(0, 8) };
    });
  };

  try {
    await ensureLogin(page);
    const step = require(path.resolve(stepFile));
    await step({ page, shot, go, BASE, overflow });
  } catch (e) {
    console.log('ERR', e.message);
  }
  if (consoleErrors.length) console.log('CONSOLE:\n' + [...new Set(consoleErrors)].slice(0, 25).join('\n'));
  else console.log('CONSOLE: clean');
  await ctx.close();
})();
