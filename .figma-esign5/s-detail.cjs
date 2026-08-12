module.exports = async ({ page, shot, go, overflow }) => {
  await go('/en/requests/esign/8b3045b9-ad38-4afe-ba45-21e0b0cf3441');
  await shot('app-03-detail-fixed');
  console.log('OVERFLOW detail', JSON.stringify(await overflow()));
  const cols = await page.evaluate(() => {
    const grid = document.querySelector('main .grid');
    return grid ? getComputedStyle(grid).gridTemplateColumns : null;
  });
  console.log('GRID COLS', cols);
  const printDisabled = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Print');
    return b ? b.disabled : 'no-button';
  });
  console.log('PRINT disabled=', printDisabled);
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('main button, main a')]
      .map((b) => `${b.tagName}:${b.innerText.trim().replace(/\s+/g, ' ')}${b.disabled ? ' [disabled]' : ''}`)
      .filter((s) => s.length > 4),
  );
  console.log('ACTIONS', JSON.stringify(btns, null, 1));
};
