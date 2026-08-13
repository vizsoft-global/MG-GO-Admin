module.exports = async ({ page, go }) => {
  await go('/en/requests/esign/categories');
  console.log(
    JSON.stringify(
      await page.evaluate(() => {
        const row = [...document.querySelectorAll('tbody tr')].find((r) =>
          r.innerText.includes('Other'),
        );
        return {
          cells: [...row.cells].map((c) => c.innerText.trim().slice(0, 30)),
          controls: [...row.querySelectorAll('button,input')].map(
            (el) =>
              `${el.tagName} type=${el.type} role=${el.getAttribute('role')} aria-checked=${el.getAttribute('aria-checked')} label=${el.getAttribute('aria-label')} txt=${el.innerText.trim().slice(0, 12)}`,
          ),
        };
      }),
      null,
      1,
    ),
  );
};
