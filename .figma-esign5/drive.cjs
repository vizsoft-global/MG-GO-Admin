// Throwaway QA driver for the E-Sign Figma verification pass. 1366x768, persistent session.
// usage: node .figma-esign5/drive.cjs <stepModule.cjs>
const path = require('path');
const { chromium } = require('C:/Users/Admin/.cursor/plugins/cache/cursor-public/browse/release_v0.2.4/node_modules/playwright-core');

const USER_DIR = path.join(__dirname, 'userdata');
const BASE = process.env.QA_BASE || 'http://localhost:3000';

// NOTE: must be reached over `localhost`, not `127.0.0.1` — the dev HMR websocket fails on the
// IPv4 literal and Next dev then never hydrates the app root.
async function ensureLogin(ctx, page, go) {
  page.setDefaultTimeout(180000);
  page.setDefaultNavigationTimeout(180000);
  await go('/en/requests/esign');
  if (!page.url().includes('/login')) {
    console.log('SESSION -> reused', page.url());
    return;
  }
  await page.fill('input[type="email"]', 'admin@vizsoft.in');
  await page.fill('input[type="password"]', 'umc#1S#rR$yh616');
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 180000 }),
    page.click('button[type="submit"]'),
  ]);
  await go('/en/requests/esign');
  console.log('SESSION ->', page.url());
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
  // Turbopack dev serves hundreds of chunks; hydration can lag far behind domcontentloaded.
  const waitHydrated = async (timeout = 180000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      let ok = false;
      try {
        ok = await page.evaluate(() =>
          Object.keys(document).some((k) => k.startsWith('__reactContainer')),
        );
      } catch {
        // navigation mid-poll (redirect) — keep polling on the new document
      }
      if (ok) return true;
      await page.waitForTimeout(1000);
    }
    return false;
  };
  const go = async (url) => {
    await page.goto(url.startsWith('http') ? url : BASE + url, { waitUntil: 'domcontentloaded' });
    const hydrated = await waitHydrated();
    try {
      await page.waitForLoadState('networkidle', { timeout: 20000 });
    } catch {}
    await page.waitForTimeout(1500);
    console.log('AT', page.url(), hydrated ? '[hydrated]' : '[NOT HYDRATED]');
  };
  // does anything overflow the 768px viewport / scroll internally?
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
  const text = async (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? el.innerText.replace(/\n{2,}/g, '\n').trim() : null;
  }, sel);

  try {
    await ensureLogin(ctx, page, go);
    const step = require(path.resolve(stepFile));
    await step({ page, shot, go, BASE, overflow, text, waitHydrated });
  } catch (e) {
    console.log('ERR', e.message, '\n', (e.stack || '').split('\n').slice(0, 4).join('\n'));
  }
  if (consoleErrors.length) console.log('CONSOLE:\n' + [...new Set(consoleErrors)].slice(0, 25).join('\n'));
  else console.log('CONSOLE: clean');
  await ctx.close();
})();
