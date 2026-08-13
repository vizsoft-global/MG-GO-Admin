// VB/05 blocked date add+remove, VB/06 department edit, VB/08 reports filters.
module.exports = async ({ page, shot, go }) => {
  // ---- VB/05: blocked date round-trip (self-cleaning)
  await go('/en/visit-bookings/slots');
  await page.locator('button:has-text("Add blocked date")').first().click();
  await page.waitForTimeout(1500);
  await shot('ix-slots-blocked-modal');
  const dateInput = page.locator('[role="dialog"] input[type="date"]').first();
  await dateInput.fill('2026-12-25');
  const reason = page.locator('[role="dialog"] input[type="text"], [role="dialog"] input:not([type])').first();
  await reason.fill('QA temp - vb6');
  await page.locator('[role="dialog"] button:has-text("Save")').first().click();
  await page.waitForTimeout(4000);
  console.log('BLOCKED_TOAST', JSON.stringify((await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).map((s) => s.replace(/\s+/g, ' ').trim())));
  await page.waitForTimeout(1500);
  const blockedCard = await page.locator('text=Blocked dates').first().locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]').innerText().catch(() => '?');
  console.log('BLOCKED_LIST', blockedCard.replace(/\s+/g, ' ').trim().slice(0, 200));
  await shot('ix-slots-blocked-added');

  // remove it again
  const removeBtn = page.locator('button[aria-label="Remove blocked date"]').first();
  if (await removeBtn.count()) {
    await removeBtn.click();
    await page.waitForTimeout(3500);
    const after = await page.locator('text=Blocked dates').first().locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]').innerText().catch(() => '?');
    console.log('BLOCKED_AFTER_REMOVE', after.replace(/\s+/g, ' ').trim().slice(0, 200));
  } else {
    console.log('BLOCKED_AFTER_REMOVE no remove button found');
  }

  // ---- VB/06: department edit modal
  await go('/en/visit-bookings/departments');
  await page.locator('button:has-text("Edit")').first().click();
  await page.waitForTimeout(1500);
  await shot('ix-dept-edit-modal');
  const modal = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return 'no-dialog';
    const r = d.getBoundingClientRect();
    return {
      h: Math.round(r.height),
      fits: r.height <= 768,
      labels: [...d.querySelectorAll('label')].map((l) => l.innerText.trim()),
      footer: d.innerText.replace(/\s+/g, ' ').trim().slice(-90),
    };
  });
  console.log('DEPT_MODAL', JSON.stringify(modal));
  await page.keyboard.press('Escape');

  // ---- VB/08: reports filters
  await go('/en/visit-bookings/reports');
  const trig = page.locator('[data-slot="select-trigger"], button[role="combobox"]').first();
  console.log('REPORTS_TRIGGER', (await trig.innerText()).trim());
  await trig.click();
  await page.waitForTimeout(800);
  console.log('REPORTS_BRANCH_OPTIONS', JSON.stringify((await page.locator('[role="option"]').allInnerTexts()).map((s) => s.trim())));
  await page.locator('[role="option"]').nth(1).click();
  await page.waitForTimeout(2500);
  console.log('REPORTS_TRIGGER_AFTER', (await trig.innerText()).trim());
  await shot('ix-reports-branch');
};
