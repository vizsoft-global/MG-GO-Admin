module.exports = async ({ page, shot, go, overflow }) => {
  // ---- 1. Sent: create-request modal ----------------------------------------
  await go('/en/requests/esign/sent');
  await shot('app-01-sent-fixed');
  console.log('OVERFLOW sent', JSON.stringify(await overflow()));
  await page.click('button:has-text("New request")');
  await page.waitForTimeout(1500);
  await shot('ix-create-modal');
  console.log(
    'MODAL FIELDS',
    JSON.stringify(
      await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return 'no-dialog';
        return {
          labels: [...dlg.querySelectorAll('label')].map((l) => l.innerText.trim()),
          inputs: [...dlg.querySelectorAll('input')].map((i) => `${i.type}${i.accept ? ' accept=' + i.accept : ''}`),
          footer: dlg.innerText.split('\n').slice(-6),
          closeBtnRect: (() => {
            const b = dlg.parentElement.querySelector('button[aria-label], button.absolute');
            return b ? JSON.stringify(b.getBoundingClientRect()) : null;
          })(),
        };
      }),
      null,
      1,
    ),
  );
  // submit with nothing filled -> must show a validation toast, not a silent no-op
  const send = page.locator('[role="dialog"] button:has-text("Send")');
  console.log('SEND disabled=', await send.isDisabled().catch(() => 'n/a'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  // ---- 2. Signatures: status tab round-trip --------------------------------
  await go('/en/requests/esign/signatures');
  await shot('app-02-signatures-fixed');
  console.log('OVERFLOW signatures', JSON.stringify(await overflow()));
  const reqs = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') reqs.push(r.url().split('?')[0].slice(-60));
  });
  await page.click('button:has-text("Signed")');
  await page.waitForTimeout(2500);
  console.log('AFTER SIGNED TAB rows=', await page.locator('tbody tr').count());
  console.log('EMPTY STATE?', await page.locator('text=No signatures').count());
  await shot('ix-signed-tab-empty');
  await page.click('button:has-text("All")');
  await page.waitForTimeout(2000);
  console.log('BACK TO ALL rows=', await page.locator('tbody tr').count());
  console.log('POSTS', JSON.stringify(reqs.slice(0, 8)));
};
