import { chromium } from "playwright";
import { existsSync } from "node:fs";
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, storageState: existsSync(".qa/session.json") ? ".qa/session.json" : undefined });
const page = await context.newPage();
page.setDefaultTimeout(200_000);
page.setDefaultNavigationTimeout(200_000);
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

const t0 = Date.now();
await page.goto(`${BASE}/en/payroll`, { waitUntil: "domcontentloaded" });
const warm = Date.now() - t0;
await page.waitForFunction(() => document.querySelectorAll("main tbody tr").length > 0, null, { timeout: 180_000 }).catch(() => {});
await page.waitForTimeout(2500);

const read = () => page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  return {
    trs: main.querySelectorAll("tbody tr").length,
    tds: main.querySelectorAll("td").length,
    nodes: main.querySelectorAll("*").length,
    cards: main.querySelectorAll(".grid > button").length,
    tables: main.querySelectorAll("table").length,
    width: document.body.scrollWidth,
    viewport: window.innerWidth,
  };
});

const tableMode = await read();
const cardsBtn = page.getByRole("radio", { name: "Cards" }).first();
const hadCards = (await cardsBtn.count()) > 0;
if (hadCards) { await cardsBtn.click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1500); }
const cardMode = await read();
// Back to the table for the next reader.
if (hadCards) { await page.getByRole("radio", { name: "Table" }).first().click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1200); }
const backToList = await read();

console.log(JSON.stringify({ warmLoadMs: warm, hadCards, tableMode, cardMode, backToList, errors: errors.slice(0, 3) }, null, 1));
await browser.close();
