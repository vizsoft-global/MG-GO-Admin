module.exports = async ({ page, go }) => {
  await go('/en/requests/esign/8b3045b9-ad38-4afe-ba45-21e0b0cf3441');
  const info = await page.evaluate(() => {
    const main = document.querySelector('main');
    const grid = main.querySelector('.grid');
    const kids = [...grid.children].map((c) => `${c.className.slice(0, 40)} h=${c.getBoundingClientRect().height}`);
    const page = main.firstElementChild;
    return {
      main: { sh: main.scrollHeight, ch: main.clientHeight, pad: getComputedStyle(main).padding },
      appPage: {
        h: page.getBoundingClientRect().height,
        cls: page.className,
        style: getComputedStyle(page).minHeight,
      },
      gridTop: grid.getBoundingClientRect().top,
      gridH: grid.getBoundingClientRect().height,
      kids,
    };
  });
  console.log(JSON.stringify(info, null, 1));
};
