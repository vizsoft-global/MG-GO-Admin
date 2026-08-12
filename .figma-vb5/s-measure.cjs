module.exports = async ({ page, go }) => {
  await go('/en/visit-bookings/calendar');
  const m = await page.evaluate(() => {
    const board = document.querySelector('[class*="max-h-[calc"]');
    const card = board?.parentElement;
    const main = document.querySelector('main');
    return {
      mainTop: main?.getBoundingClientRect().top,
      mainBottom: main?.getBoundingClientRect().bottom,
      cardTop: card?.getBoundingClientRect().top,
      boardScroll: board?.scrollHeight,
      boardClient: board?.clientHeight,
      viewport: window.innerHeight,
    };
  });
  console.log('MEASURE', JSON.stringify(m));
};
