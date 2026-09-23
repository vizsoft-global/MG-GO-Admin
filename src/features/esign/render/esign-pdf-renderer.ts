import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildEsignDocumentHtml,
  type EsignDocumentInput,
} from "./esign-document-html";

const FONT_DIR = path.join(process.cwd(), "src/features/esign/render/fonts");

/** npm 147 ships an empty `bin/` on some installs; Vercel traces often omit it. */
const SPARTICUZ_PACK_URL =
  process.env.ESIGN_CHROMIUM_PACK_URL ??
  "https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar";

function detectChrome(): string | null {
  if (process.env.CHROME_EXECUTABLE_PATH && existsSync(process.env.CHROME_EXECUTABLE_PATH)) {
    return process.env.CHROME_EXECUTABLE_PATH;
  }
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function fontFace(family: string, file: string): string {
  const full = path.join(FONT_DIR, file);
  if (!existsSync(full)) return "";
  const b64 = readFileSync(full).toString("base64");
  return `@font-face{font-family:"${family}";src:url(data:font/ttf;base64,${b64}) format("truetype");font-weight:400 700;font-style:normal;font-display:block;}`;
}

export function embeddedFontCss(): string {
  return [
    fontFace("Noto Sans", "NotoSans-Regular.ttf"),
    fontFace("Noto Sans Arabic", "NotoSansArabic-Regular.ttf"),
  ].join("");
}

export async function launchEsignBrowser() {
  const puppeteer = await import("puppeteer-core");
  const localChrome = detectChrome();
  if (localChrome) {
    return puppeteer.default.launch({
      executablePath: localChrome,
      headless: true,
      args: ["--no-sandbox", "--font-render-hinting=none"],
    });
  }
  const chromium = (await import("@sparticuz/chromium")).default;
  chromium.setGraphicsMode = false;
  const chromeBin = process.env.VERCEL
    ? await chromium.executablePath(SPARTICUZ_PACK_URL)
    : await chromium.executablePath();
  return puppeteer.default.launch({
    args: puppeteer.default.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: chromeBin,
    headless: "shell",
  });
}

export async function renderEsignPdf(
  input: Omit<EsignDocumentInput, "fontCss">,
  browser: Awaited<ReturnType<typeof launchEsignBrowser>>,
): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    const html = buildEsignDocumentHtml({ ...input, fontCss: embeddedFontCss() });
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    return new Uint8Array(pdf);
  } finally {
    await page.close();
  }
}
