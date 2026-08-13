// VB/07 branches: Add modal shape + Edit round-trip (desks 1 -> 2).
module.exports = async ({ page, shot, go, overflow }) => {
  await go('/en/visit-bookings/branches');
  await shot('vb07-branches');
  console.log('OVERFLOW', JSON.stringify(await overflow()));

  // Add modal: footer-first, close button outside the frame
  await page.locator('button:has-text("Add branch")').first().click();
  await page.waitForTimeout(1200);
  await shot('ix-branch-add-modal');
  const modal = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return 'no-dialog';
    const r = d.getBoundingClientRect();
    const labels = [...d.querySelectorAll('label')].map((l) => l.innerText.trim());
    const closeBtn = d.querySelector('button[aria-label], button:has(svg.lucide-x)');
    const cr = closeBtn ? closeBtn.getBoundingClientRect() : null;
    const footer = [...d.querySelectorAll('div')].find((el) => el.className.includes('border-t'));
    const saveBtn = [...d.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Save');
    return {
      box: { top: Math.round(r.top), h: Math.round(r.height), fits: r.height <= 768 },
      labels,
      closeOutside: cr ? { top: Math.round(cr.top - r.top), right: Math.round(cr.right - r.right) } : null,
      footerText: footer ? footer.innerText.replace(/\s+/g, ' ').trim().slice(0, 90) : null,
      saveDisabled: saveBtn ? saveBtn.disabled : null,
    };
  });
  console.log('ADD_MODAL', JSON.stringify(modal));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  // Edit round-trip
  await page.locator('button:has-text("Edit")').first().click();
  await page.waitForTimeout(1200);
  await shot('ix-branch-edit-modal');
  const desks = page.locator('input[type="number"]').first();
  console.log('DESKS_BEFORE', await desks.inputValue());
  await desks.fill('2');
  await page.locator('button:has-text("Save")').first().click();
  await page.waitForTimeout(4000);
  const toast = await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => []);
  console.log('TOAST', JSON.stringify(toast.map((s) => s.replace(/\s+/g, ' ').trim())));
  await page.waitForTimeout(1500);
  console.log('ROW_AFTER', (await page.locator('tbody tr').first().innerText()).replace(/\s+/g, ' ').trim());
  await shot('ix-branch-after-save');
};
