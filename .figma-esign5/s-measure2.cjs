module.exports = async ({ page, go }) => {
  await go('/en/requests/esign/8b3045b9-ad38-4afe-ba45-21e0b0cf3441');
  console.log(
    JSON.stringify(
      await page.evaluate(() => {
        const scroller = [...document.querySelectorAll('main')].map((m) => ({
          cls: m.className.slice(0, 60),
          sh: m.scrollHeight,
          ch: m.clientHeight,
        }));
        const rail = document.querySelector('main .grid').children[1];
        const kids = [...rail.children].map(
          (c) => `${c.tagName} h=${Math.round(c.getBoundingClientRect().height)} :: ${c.innerText.split('\n')[0]}`,
        );
        return { scroller, railH: rail.getBoundingClientRect().height, kids };
      }),
      null,
      1,
    ),
  );
};
