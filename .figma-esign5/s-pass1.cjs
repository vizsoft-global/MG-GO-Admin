module.exports = async ({ page, shot, go, overflow, text }) => {
  const screens = [
    ['app-00-hub', '/en/requests/esign'],
    ['app-01-sent', '/en/requests/esign/sent'],
    ['app-02-signatures', '/en/requests/esign/signatures'],
    ['app-04-categories', '/en/requests/esign/categories'],
  ];
  for (const [name, url] of screens) {
    await go(url);
    await shot(name);
    console.log('OVERFLOW', name, JSON.stringify(await overflow()));
    console.log('MAIN TEXT', name, '\n' + (await text('main')));
    console.log('---');
  }

  // detail: first row of signatures list
  await go('/en/requests/esign/signatures');
  const href = await page.evaluate(() => {
    const a = document.querySelector('tbody a[href*="/requests/esign/"]');
    return a ? a.getAttribute('href') : null;
  });
  console.log('DETAIL HREF', href);
  if (href) {
    await go(href);
    await shot('app-03-detail');
    console.log('OVERFLOW detail', JSON.stringify(await overflow()));
    console.log('MAIN TEXT detail\n' + (await text('main')));
  }
};
