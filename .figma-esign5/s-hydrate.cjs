module.exports = async ({ page, go }) => {
  await go('/en/login');
  await page.waitForTimeout(8000);
  const info = await page.evaluate(() => {
    const form = document.querySelector('form');
    const keys = form ? Object.keys(form).filter((k) => k.startsWith('__react')) : [];
    const btn = document.querySelector('button[type="submit"]');
    const btnKeys = btn ? Object.keys(btn).filter((k) => k.startsWith('__react')) : [];
    return {
      formReactKeys: keys,
      btnReactKeys: btnKeys,
      scripts: [...document.querySelectorAll('script[src]')].length,
      hasNextData: typeof window.__next_f !== 'undefined',
      btnDisabled: btn ? btn.disabled : null,
      btnOuter: btn ? btn.outerHTML.slice(0, 300) : null,
    };
  });
  console.log(JSON.stringify(info, null, 1));

  // try submitting via requestSubmit + Enter key
  await page.fill('#email', 'admin@vizsoft.in');
  await page.fill('#password', 'umc#1S#rR$yh616');
  await page.press('#password', 'Enter');
  await page.waitForTimeout(12000);
  console.log('after Enter url =', page.url());
  await page.evaluate(() => document.querySelector('form').requestSubmit());
  await page.waitForTimeout(15000);
  console.log('after requestSubmit url =', page.url());
};
