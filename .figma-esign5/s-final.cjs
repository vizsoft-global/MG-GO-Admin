module.exports = async ({ page, shot, go, overflow }) => {
  const screens = [
    ['fin-00-hub', '/en/requests/esign'],
    ['fin-01-sent', '/en/requests/esign/sent'],
    ['fin-02-signatures', '/en/requests/esign/signatures'],
    ['fin-04-categories', '/en/requests/esign/categories'],
    ['fin-03-detail', '/en/requests/esign/8b3045b9-ad38-4afe-ba45-21e0b0cf3441'],
  ];
  for (const [name, url] of screens) {
    await go(url);
    await shot(name);
    const geo = await page.evaluate(() => {
      const t = document.querySelector('table');
      const wrap = t?.parentElement;
      return {
        tableW: t ? Math.round(t.getBoundingClientRect().width) : null,
        wrapW: wrap ? wrap.clientWidth : null,
        hScroll: wrap ? wrap.scrollWidth - wrap.clientWidth : null,
        headers: t ? [...t.querySelectorAll('th')].map((h) => h.innerText.trim()) : null,
      };
    });
    console.log(name, JSON.stringify(await overflow()), JSON.stringify(geo));
  }
};
