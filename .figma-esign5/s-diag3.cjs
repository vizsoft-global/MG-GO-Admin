module.exports = async ({ page }) => {
  await page.addInitScript(() => {
    window.__errs = [];
    window.addEventListener('error', (e) => {
      window.__errs.push('error: ' + (e.message || '') + ' @ ' + (e.filename || '').slice(-90));
    });
    window.addEventListener('unhandledrejection', (e) => {
      window.__errs.push('rejection: ' + String(e.reason && (e.reason.message || e.reason)).slice(0, 200));
    });
  });
  await page.goto('http://127.0.0.1:3000/en/login', { waitUntil: 'load', timeout: 180000 });
  await page.waitForTimeout(15000);
  const out = await page.evaluate(() => ({
    errs: window.__errs || [],
    reactOnDoc: Object.keys(document).filter((k) => k.startsWith('__react')),
    turbopackErr: typeof window.__turbopack_error__,
    devOverlay: !!document.querySelector('nextjs-portal'),
    overlayText: document.querySelector('nextjs-portal')
      ? (document.querySelector('nextjs-portal').shadowRoot
          ? document.querySelector('nextjs-portal').shadowRoot.textContent.slice(0, 600)
          : 'no shadow')
      : null,
  }));
  console.log(JSON.stringify(out, null, 1));
};
