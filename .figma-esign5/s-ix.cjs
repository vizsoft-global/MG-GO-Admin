module.exports = async ({ page, shot, go }) => {
  const posts = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && !r.url().includes('/monitoring')) posts.push(r.url().slice(0, 80));
  });
  await go('/en/requests/esign/sent');
  await page.waitForTimeout(20000); // give client queries a chance
  console.log('POSTS after load:', posts.length, JSON.stringify(posts.slice(0, 5)));
  const kpis = await page.evaluate(() =>
    [...document.querySelectorAll('main')].map((m) => m.innerText).join('\n').slice(0, 400),
  );
  console.log('KPI SNAPSHOT:\n' + kpis);
  // click Refresh (client onClick -> server action)
  const before = posts.length;
  try {
    await page.getByRole('button', { name: /Refresh/i }).click({ timeout: 15000 });
    await page.waitForTimeout(8000);
    console.log('POSTS after Refresh click:', posts.length - before);
  } catch (e) {
    console.log('Refresh click failed:', e.message.slice(0, 120));
  }
  await shot('ix-sent-after-refresh');
};
