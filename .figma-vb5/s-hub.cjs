module.exports = async ({ shot, go, overflow }) => {
  const routes = [
    ['vb00-hub', '/en/visit-bookings'],
    ['vb01-all', '/en/visit-bookings/all'],
    ['vb02-calendar', '/en/visit-bookings/calendar'],
    ['vb05-slots', '/en/visit-bookings/slots'],
    ['vb06-depts', '/en/visit-bookings/departments'],
    ['vb07-branches', '/en/visit-bookings/branches'],
    ['vb08-reports', '/en/visit-bookings/reports'],
  ];
  for (const [name, url] of routes) {
    await go(url);
    await shot(name);
    console.log('OVERFLOW', name, JSON.stringify(await overflow()));
  }
};
