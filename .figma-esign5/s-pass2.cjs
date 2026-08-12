module.exports = async ({ page, shot, go, overflow, text }) => {
  const screens = [
    ['app-02-signatures', '/en/requests/esign/signatures'],
    ['app-04-categories', '/en/requests/esign/categories'],
    ['app-03-detail', '/en/requests/esign/8b3045b9-ad38-4afe-ba45-21e0b0cf3441'],
    ['app-01-sent', '/en/requests/esign/sent'],
    ['app-00-hub', '/en/requests/esign'],
  ];
  for (const [name, url] of screens) {
    await go(url);
    await page.waitForTimeout(15000); // let client queries settle
    await shot(name);
    console.log('OVERFLOW', name, JSON.stringify(await overflow()));
    console.log('TEXT', name, '\n' + (await text('main')));
    console.log('---');
  }
};
