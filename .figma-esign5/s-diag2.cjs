module.exports = async ({ page }) => {
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && !r.url().includes('/monitoring')) {
      posts += 1;
      console.log('POST ->', r.url().slice(0, 100));
    }
  });
  await page.goto('http://127.0.0.1:3000/en/login', { waitUntil: 'load', timeout: 180000 });
  await page.waitForTimeout(12000);
  const probe = await page.evaluate(() => {
    const scan = (el) => Object.keys(el).filter((k) => k.startsWith('__react'));
    return {
      onDocument: scan(document),
      onBody: scan(document.body),
      onForm: document.querySelector('form') ? scan(document.querySelector('form')) : 'no form',
      firstDiv: document.body.firstElementChild ? scan(document.body.firstElementChild) : 'none',
      hasNextGlobal: typeof window.next,
      buttons: [...document.querySelectorAll('button')].map((b) => b.type + ':' + b.innerText.trim()),
    };
  });
  console.log(JSON.stringify(probe, null, 1));
  await page.fill('#email', 'admin@vizsoft.in');
  await page.fill('#password', 'umc#1S#rR$yh616');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(20000);
  console.log('posts =', posts, 'url =', page.url());
};
