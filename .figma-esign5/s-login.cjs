module.exports = async ({ page, shot, go, text }) => {
  page.on('response', (r) => {
    if (r.request().method() === 'POST') console.log('POST', r.status(), r.url().slice(0, 90));
  });
  await go('/en/login');
  await page.fill('#email', 'admin@vizsoft.in');
  await page.fill('#password', 'umc#1S#rR$yh616');
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
    console.log('NAVIGATED', page.url());
  } catch (e) {
    console.log('NO NAV after 90s, url =', page.url());
  }
  await page.waitForTimeout(3000);
  await shot('login-after');
  console.log('BODY TEXT\n' + (await text('body')).slice(0, 800));
};
