// Identify the failing request on the visits screens.
module.exports = async ({ page, go }) => {
  const bodies = [];
  page.on('response', async (r) => {
    if (r.status() >= 400) {
      let body = '';
      try { body = (await r.text()).slice(0, 400); } catch {}
      bodies.push(`${r.status()} ${r.request().method()} ${r.url()}\n  ${body.replace(/\s+/g, ' ')}`);
    }
  });
  for (const route of ['/en/visit-bookings/all', '/en/visit-bookings', '/en/visit-bookings/branches']) {
    await go(route);
    await page.waitForTimeout(1500);
  }
  console.log('FAILED_REQUESTS:\n' + (bodies.join('\n') || 'none'));
};
