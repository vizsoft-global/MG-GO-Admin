// Pass A: VB/07 branches, VB/01 all visits, VB/00 hub — screenshot + overflow.
module.exports = async ({ shot, go, overflow }) => {
  for (const [route, name] of [
    ['/en/visit-bookings/branches', 'vb07-branches'],
    ['/en/visit-bookings/all', 'vb01-all'],
    ['/en/visit-bookings', 'vb00-hub'],
  ]) {
    await go(route);
    await shot(name);
    console.log('OVERFLOW', name, JSON.stringify(await overflow()));
  }
};
