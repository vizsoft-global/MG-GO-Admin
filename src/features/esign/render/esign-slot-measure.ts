import type { SignSlot, SignSlotRole } from "./esign-document-layout";

/**
 * Measures every printed signature line into PDF points.
 *
 * The reference sheets place the manager boxes at the foot of the form, not on
 * the old fixed skeleton. Measuring the rendered HTML is the only way to keep
 * the compose function stamping into the lines the rider actually saw.
 */
export async function measureEsignSlots(
  html: string,
  browser: Awaited<ReturnType<typeof import("./esign-pdf-renderer").launchEsignBrowser>>,
): Promise<SignSlot[]> {
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    const rows = await page.evaluate(() => {
      const root = document.querySelector(".page");
      if (!root) return [];
      const pageBox = root.getBoundingClientRect();
      const scaleX = 595.28 / (pageBox.width || 1);
      const scaleY = 841.89 / (pageBox.height || 1);
      return Array.from(root.querySelectorAll("[data-slot-role]")).map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          role: node.getAttribute("data-slot-role") ?? "",
          xPt: (rect.left - pageBox.left) * scaleX,
          yPt: 841.89 - (rect.bottom - pageBox.top) * scaleY,
          wPt: rect.width * scaleX,
          hPt: rect.height * scaleY,
        };
      });
    });
    const roles: SignSlotRole[] = [
      "employee",
      "hr",
      "gm",
      "ceo",
      "ack_received",
      "ack_not_received",
    ];
    return rows
      .filter(
        (row) => roles.includes(row.role as SignSlotRole) && row.wPt >= 8 && row.hPt >= 8,
      )
      .map((row) => ({
        id: row.role,
        role: row.role as SignSlotRole,
        page: 1,
        xPt: Math.round(row.xPt * 100) / 100,
        yPt: Math.round(row.yPt * 100) / 100,
        wPt: Math.round(row.wPt * 100) / 100,
        hPt: Math.round(row.hPt * 100) / 100,
      }));
  } catch (error) {
    console.error("esign slot measurement", error);
    return [];
  } finally {
    await page.close();
  }
}
