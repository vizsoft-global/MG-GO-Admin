#!/usr/bin/env node
/**
 * Builds the client user manual PDF from docs/USER_MANUAL.md.
 *
 *   npm run docs:manual
 *
 * Markdown -> HTML (marked) -> print (Chrome via Playwright). The cover and the
 * table of contents are generated here, so the markdown stays a plain document
 * that reads well on GitHub. No screenshots: the manual is text-only by design.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { marked } from 'marked';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const WORK = path.join(os.tmpdir(), 'mghub-user-manual');

/**
 * Which manual to build. `user` is the rider app (+ console companion),
 * `admin` is the console-only manual. Pass it as the first argument.
 */
const DOCS = {
  user: {
    src: path.join(ROOT, 'docs', 'USER_MANUAL.md'),
    out: path.join(ROOT, 'docs', 'USER_MANUAL.pdf'),
    title: 'MG-GO / Musallam Delivery',
    subtitle: 'User Manual',
    standfirst:
      'How riders use the MG-GO Android application — signing in, going on duty, recording deliveries, earnings, vehicle and support — and how the office console produces what they see.',
    chips: ['Rider app · Android', 'Admin console · web', 'English / العربية', 'Version 1.0 · 4 Nov 2026'],
    source: 'Written from the rider app and admin console source · No screenshots · English edition',
  },
  admin: {
    src: path.join(ROOT, 'docs', 'ADMIN_PANEL_MANUAL.md'),
    out: path.join(ROOT, 'docs', 'ADMIN_PANEL_MANUAL.pdf'),
    title: 'MG-GO Admin Console',
    subtitle: 'Administrator User Manual',
    standfirst:
      'How operations, HR, payroll, fleet and administration staff run the delivery platform — employees and access, the live map, verification, requests, visits, signatures, fleet, pay and settings.',
    chips: ['Admin console · web', 'Rider app · Android', 'English / العربية', 'Version 1.0 · 4 Nov 2026'],
    source: 'Written from the admin console source · No screenshots · English edition',
  },
};

const DOC_KEY = process.argv[2] || 'user';
const DOC = DOCS[DOC_KEY];
if (!DOC) {
  console.error(`unknown manual "${DOC_KEY}" — use one of: ${Object.keys(DOCS).join(', ')}`);
  process.exit(1);
}
const SRC = DOC.src;
const OUT = DOC.out;

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

function renderMarkdown(md) {
  const toc = [];

  marked.use({
    gfm: true,
    renderer: {
      heading(token) {
        const inline = this.parser.parseInline(token.tokens);
        const plain = inline.replace(/<[^>]+>/g, '');
        const id = slug(plain) || `h-${toc.length}`;
        if (token.depth === 2 || token.depth === 3) {
          toc.push({ depth: token.depth, id, text: plain });
        }
        return `<h${token.depth} id="${id}">${inline}</h${token.depth}>\n`;
      },
      code(token) {
        const body = token.text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return `<pre class="code"><code>${body}</code></pre>\n`;
      },
      table(token) {
        const head = token.header
          .map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`)
          .join('');
        const body = token.rows
          .map(
            (row) =>
              `<tr>${row.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`,
          )
          .join('');
        return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>\n`;
      },
    },
  });

  const body = marked.parse(md);
  return { body, toc };
}

const CSS = `
  :root {
    --ink:#1b1c22; --muted:#5b6068; --line:#dcdfe5; --soft:#f5f6f8;
    --navy:#27273f; --rust:#a73c24;
  }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; }
  @page { size: A4 portrait; margin: 18mm 16mm 18mm; }
  body {
    font-family:"Segoe UI","Inter",system-ui,-apple-system,sans-serif;
    color:var(--ink); font-size:10.2pt; line-height:1.55;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }

  /* ---------- cover ---------- */
  .cover { height:245mm; display:flex; flex-direction:column; justify-content:space-between;
    break-after:page; page-break-after:always; }
  .cover-top { display:flex; align-items:center; gap:10px; }
  .cover-mark { width:34px; height:34px; border-radius:9px; background:var(--navy); color:#fff;
    font-weight:700; font-size:13px; letter-spacing:.02em; display:flex; align-items:center; justify-content:center; }
  .cover-kicker { font-size:8pt; letter-spacing:.2em; text-transform:uppercase; color:var(--muted); }
  .cover-main { margin-top:34mm; }
  .cover h1 { font-size:31pt; line-height:1.08; margin:0 0 6px; letter-spacing:-.015em; font-weight:700; }
  .cover h2 { font-size:19pt; margin:0 0 22px; font-weight:400; color:var(--rust); border:0; padding:0; }
  .cover-rule { height:3px; width:62px; background:var(--rust); margin:0 0 20px; }
  .cover .standfirst { font-size:11.5pt; color:#3a3f47; max-width:132mm; margin:0; }
  .cover-chips { display:flex; flex-wrap:wrap; gap:7px; margin-top:26px; }
  .chip { font-size:8pt; color:#3a3f47; border:1px solid var(--line); border-radius:999px; padding:4px 10px; background:var(--soft); }
  .cover-meta { font-size:8pt; color:var(--muted); border-top:1px solid var(--line); padding-top:9px; }

  /* ---------- contents ---------- */
  .toc { break-after:page; page-break-after:always; }
  .toc h2 { font-size:15pt; margin:0 0 14px; }
  .toc ol { list-style:none; margin:0; padding:0; }
  .toc li { margin:0; }
  .toc .lvl2 { margin:11px 0 3px; font-weight:700; font-size:10pt; color:var(--navy); }
  .toc .lvl3 { margin:0 0 0 14px; font-size:9.2pt; color:#3a3f47; }
  .toc .lvl3 a::before { content:"· "; color:var(--rust); }
  .toc a { color:inherit; text-decoration:none; }

  /* ---------- body ---------- */
  h1, h2, h3, h4 { break-after:avoid; page-break-after:avoid; }
  h2 { font-size:16pt; margin:0 0 12px; padding-bottom:7px; border-bottom:2px solid var(--navy);
    color:var(--navy); break-before:page; page-break-before:always; }
  h2:first-of-type { break-before:auto; page-break-before:auto; }
  h3 { font-size:12.6pt; margin:20px 0 8px; color:var(--navy); }
  h4 { font-size:10.6pt; margin:14px 0 6px; color:var(--rust); letter-spacing:.01em; }
  p { margin:0 0 8px; }
  ul, ol { margin:0 0 10px; padding-left:18px; }
  li { margin:0 0 4px; break-inside:avoid; }
  strong { font-weight:700; }
  em { font-style:italic; color:#3a3f47; }
  a { color:var(--rust); text-decoration:none; }

  table { width:100%; border-collapse:collapse; margin:6px 0 14px; font-size:8.9pt; }
  thead { display:table-header-group; }
  th { text-align:left; background:var(--navy); color:#fff; font-weight:600; padding:6px 8px; border:1px solid var(--navy); }
  td { padding:5px 8px; border:1px solid var(--line); vertical-align:top; }
  tbody tr:nth-child(even) td { background:#fafafb; }
  tr { break-inside:avoid; page-break-inside:avoid; }

  blockquote { margin:10px 0 14px; padding:9px 12px; background:#fbf7f5;
    border-left:3px solid var(--rust); font-size:9.4pt; color:#3a3f47; break-inside:avoid; }
  blockquote p { margin:0; }

  pre.code { background:var(--soft); border:1px solid var(--line); border-radius:6px;
    padding:9px 11px; font-family:Consolas,"Cascadia Mono",monospace; font-size:8.6pt;
    line-height:1.45; white-space:pre-wrap; break-inside:avoid; margin:6px 0 14px; }
  code { font-family:Consolas,"Cascadia Mono",monospace; font-size:8.9pt; background:var(--soft);
    padding:1px 4px; border-radius:3px; }
  pre.code code { background:none; padding:0; }

  hr { border:0; border-top:1px solid var(--line); margin:16px 0; }
`;

function buildHtml(body, toc) {
  const tocHtml = toc
    .map((item) => `<li class="lvl${item.depth}"><a href="#${item.id}">${item.text}</a></li>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${DOC.title} — ${DOC.subtitle}</title>
<style>${CSS}</style>
</head>
<body>
  <section class="cover">
    <div class="cover-top">
      <div class="cover-mark">MG</div>
      <div class="cover-kicker">Musallam Group · Delivery Operations</div>
    </div>
    <div class="cover-main">
      <h1>${DOC.title}</h1>
      <h2>${DOC.subtitle}</h2>
      <div class="cover-rule"></div>
      <p class="standfirst">${DOC.standfirst}</p>
      <div class="cover-chips">
        ${DOC.chips.map((c) => `<span class="chip">${c}</span>`).join('')}
      </div>
    </div>
    <div class="cover-meta">
      ${DOC.source}
    </div>
  </section>

  <section class="toc">
    <h2>Contents</h2>
    <ol>${tocHtml}</ol>
  </section>

  ${body}
</body>
</html>`;
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  if (!fs.existsSync(SRC)) throw new Error(`missing source: ${SRC}`);

  // the cover carries the title, so drop the duplicated leading H1
  const md = fs.readFileSync(SRC, 'utf8').replace(/^#\s+.*\r?\n/, '');
  const { body, toc } = renderMarkdown(md);
  const html = buildHtml(body, toc);

  const htmlPath = path.join(WORK, 'user-manual.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({
    ...(chromePath ? { executablePath: chromePath } : { channel: 'chrome' }),
    args: ['--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  try {
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });
    await page.pdf({
      path: OUT,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate:
        '<div style="width:100%;font-size:7pt;color:#8a8f99;padding:0 16mm;font-family:Segoe UI,sans-serif;">MG-GO / Musallam Delivery — User Manual</div>',
      footerTemplate:
        '<div style="width:100%;font-size:7pt;color:#8a8f99;padding:0 16mm;font-family:Segoe UI,sans-serif;display:flex;justify-content:space-between;"><span>Version 1.0 · 4 November 2026</span><span class="pageNumber"></span></div>',
    });
  } finally {
    await browser.close();
  }

  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  const pages = (fs.readFileSync(OUT).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(
    `wrote ${path.relative(ROOT, OUT)} — ${pages} pages, ${kb} KB (${toc.length} contents entries)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


