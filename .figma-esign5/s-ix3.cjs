module.exports = async ({ page, shot, go, overflow }) => {
  // ---- Category select now shows a label, not the raw value -----------------
  await go('/en/requests/esign/sent');
  await page.click('button:has-text("New request")');
  await page.waitForTimeout(1200);
  console.log(
    'CATEGORY TRIGGER =',
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const trig = [...dlg.querySelectorAll('button')].find((b) =>
        b.getAttribute('aria-haspopup') === 'listbox' || b.role === 'combobox',
      );
      return trig ? trig.innerText.trim() : 'not-found';
    }),
  );
  await shot('ix-create-modal-fixed');
  await page.keyboard.press('Escape');

  // ---- Categories: screenshot toggle round-trip on "Other", then revert -----
  await go('/en/requests/esign/categories');
  await shot('app-04-categories-fixed');
  console.log('OVERFLOW categories', JSON.stringify(await overflow()));
  const state = async () =>
    page.evaluate(() => {
      const row = [...document.querySelectorAll('tbody tr')].find((r) =>
        r.innerText.startsWith('O\nOther'),
      );
      if (!row) return 'row-not-found';
      const sw = row.querySelectorAll('button[role="switch"]')[0];
      return { label: row.cells[3].innerText.trim(), checked: sw.getAttribute('aria-checked') };
    });
  console.log('BEFORE', JSON.stringify(await state()));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) =>
      r.innerText.startsWith('O\nOther'),
    );
    row.querySelectorAll('button[role="switch"]')[0].click();
  });
  await page.waitForTimeout(3500);
  console.log('AFTER TOGGLE', JSON.stringify(await state()));
  // revert so production data is untouched
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) =>
      r.innerText.startsWith('O\nOther'),
    );
    row.querySelectorAll('button[role="switch"]')[0].click();
  });
  await page.waitForTimeout(3500);
  console.log('REVERTED', JSON.stringify(await state()));
};
