// Throwaway QA driver: persistent-session Chromium at 1366x768.
// usage: node .figma-vb6/drive.cjs <stepModule.cjs>
const path = require('path');
const { chromium } = require('C:/Users/Admin/.cursor/plugins/cache/cursor-public/browse/release_v0.2.4/node_modules/playwright-core');

const USER_DIR = path.join(__dirname, 'userdata');
const BASE = 'http://localhost:3000';

async function ensureLogin(page) {
  page.setDefaultTimeout(240000);
  page.setDefaultNavigationTimeout(240000);
  try {
    await page.goto(`${BASE}/en/visit-bookings`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    if (!page.url().includes('/login')) return;
  } catch (e) {
    console.log('SESSION_PROBE_ERR', e.message.split('\n')[0]);
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
    } catch (e) {
      console.log('LOGIN_NAV_ERR', e.message.split('\n')[0]);
      await page.waitForTimeout(4000);
      continue;
    }
    try {
      await page.waitForLoadState('networkidle', { timeout: 30000 });
    } catch {}
    // the inputs are controlled, so wait for hydration before typing
    await page.waitForTimeout(4000);
    const email = page.locator('input[type="email"], input[name="email"]').first();
    const pass = page.locator('input[type="password"], input[name="password"]').first();
    await email.click();
    await email.fill('admin@vizsoft.in');
    await pass.click();
    await pass.fill('umc#1S#rR$yh616');
    if ((await email.inputValue()) !== 'admin@vizsoft.in') {
      console.log('LOGIN fields reset, retrying');
      continue;
    }
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60000 });
    } catch {}
    console.log('LOGIN ->', page.url(), 'attempt', attempt);
    if (!page.url().includes('/login')) return;
  }
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
  page.on('response', (r) => {
    if (r.status() >= 400) consoleErrors.push(`[http ${r.status()}] ${r.request().method()} ${r.url().slice(0, 160)}`);
  });

  const shot = async (name, opts = {}) => {
    await page.screenshot({ path: path.join(__dirname, `${name}.png`), fullPage: !!opts.full });
    console.log('SHOT', name, opts.full ? '(full)' : '(viewport)');
  };
  // Dev-only: SSR of the shared sidebar intermittently throws
  // "No QueryClient set" and the route answers 500. Retry the navigation.
  const go = async (url) => {
    const target = url.startsWith('http') ? url : BASE + url;
    for (let attempt = 1; attempt <= 4; attempt++) {
      let res = null;
      try {
        res = await page.goto(target, { waitUntil: 'domcontentloaded' });
      } catch (e) {
        console.log('NAV_ERR', e.message.split('\n')[0], 'attempt', attempt);
        await page.waitForTimeout(3000);
        continue;
      }
      const status = res ? res.status() : 0;
      if (status < 500) {
        try {
          await page.waitForLoadState('networkidle', { timeout: 30000 });
        } catch {}
        await page.waitForTimeout(2500);
        console.log('AT', page.url(), status === 200 ? '' : `(status ${status})`);
        return;
      }
      console.log('RETRY', target, 'status', status, 'attempt', attempt);
      await page.waitForTimeout(2000);
    }
    console.log('GIVING UP on', target);
  };
  // does the page or any inner container overflow the viewport?
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
