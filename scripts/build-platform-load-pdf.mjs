#!/usr/bin/env node
/**
 * Renders docs/perf/platform-load-map.md to docs/perf/platform-load-map.pdf.
 *
 * Markdown -> HTML (marked) -> print (Chrome via Playwright), with the four
 * Mermaid diagrams rendered live and placed on their own landscape pages so the
 * labels stay readable. Mermaid itself is fetched once and cached in the OS temp
 * dir; nothing is written into the repo except the PDF.
 *
 *   npm run docs:pdf
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { marked } from 'marked';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'docs/perf/platform-load-map.md');
const OUT = path.join(ROOT, 'docs/perf/platform-load-map.pdf');
const WORK = path.join(os.tmpdir(), 'mghub-platform-load-pdf');
const MERMAID_PATH = path.join(WORK, 'mermaid.min.js');
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));

async function ensureMermaid() {
  if (fs.existsSync(MERMAID_PATH) && fs.statSync(MERMAID_PATH).size > 500_000) return;
  const res = await fetch(MERMAID_URL);
  if (!res.ok) throw new Error(`mermaid download failed: ${res.status}`);
  fs.writeFileSync(MERMAID_PATH, Buffer.from(await res.arrayBuffer()));
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

function renderMarkdown(md) {
  const toc = [];
  let figure = 0;

  marked.use({
    gfm: true,
    renderer: {
      heading(token) {
        const inline = this.parser.parseInline(token.tokens);
        const plain = inline.replace(/<[^>]+>/g, '');
        const id = slug(plain) || `h-${toc.length}`;
        if (token.depth <= 3) toc.push({ depth: token.depth, id, text: plain });
        return `<h${token.depth} id="${id}">${inline}</h${token.depth}>\n`;
      },
      code(token) {
        const lang = (token.lang || '').trim();
        if (lang === 'mermaid') {
          figure += 1;
          const label = token.text.replace(/</g, '&lt;');
          return `<figure class="figure"><div class="mermaid">${label}</div><figcaption>Figure ${figure}</figcaption></figure>\n`;
        }
        return `<pre class="code"><code>${token.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>\n`;
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

  let body = marked.parse(md);
  // relative .md links are meaningless inside a PDF — keep the name, drop the link
  body = body.replace(/<a href="\.\/[^"]+\.md">([^<]+)<\/a>/g, '<span class="inline-doc">$1</span>');
  return { body, toc };
}

const CSS = `
  :root { --ink:#17181c; --muted:#5c616b; --line:#d9dce3; --soft:#f4f5f8; --accent:#0f766e; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; }
  @page { size: A4 portrait; margin: 13mm 12mm 14mm; }
  @page diagram { size: A4 landscape; margin: 12mm 12mm 14mm; }
  body {
    font-family:"Segoe UI","Inter",system-ui,-apple-system,sans-serif;
    color:var(--ink); font-size:10.5pt; line-height:1.5;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  .cover { height:252mm; display:flex; flex-direction:column; justify-content:space-between; page-break-after:always; }
  .cover-top { display:flex; align-items:center; gap:10px; }
  .cover-mark { width:34px; height:34px; border-radius:9px; background:var(--accent); color:#fff;
    font-weight:700; font-size:15px; display:flex; align-items:center; justify-content:center; }
  .cover-kicker { font-size:8.5pt; letter-spacing:.18em; text-transform:uppercase; color:var(--muted); }
  .cover-main { margin-top:40mm; }
  .cover h1 { font-size:30pt; line-height:1.15; margin:0 0 14px; letter-spacing:-.01em; font-weight:700; }
  .cover .sub { font-size:12pt; color:var(--muted); max-width:135mm; margin:0; }
  .cover-rule { height:3px; width:64px; background:var(--accent); margin:26px 0 20px; }
  .cover-layers { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
  .cover-chip { font-size:8.5pt; border:1px solid var(--line); border-radius:999px; padding:3px 10px;
    color:var(--muted); background:var(--soft); }
  .cover-meta { border-top:1px solid var(--line); padding-top:12px; font-size:8.5pt; color:var(--muted); }
  .cover-meta b { color:var(--ink); font-weight:600; }
  .toc { page-break-after:always; }
  .toc h2 { margin-top:0; }
  .toc-row { padding:2.5px 0; border-bottom:1px dotted #e6e8ee; }
  .toc-row a { color:var(--ink); text-decoration:none; }
  .toc-d3 { padding-left:14px; font-size:9.5pt; color:var(--muted); }
  h1,h2,h3,h4 { color:var(--ink); line-height:1.25; }
  h2 { font-size:14.5pt; margin:20px 0 8px; padding-bottom:5px; border-bottom:1.5px solid var(--line);
    break-after:avoid; page-break-after:avoid; }
  h3 { font-size:11.6pt; margin:14px 0 6px; color:#23252b; break-after:avoid; page-break-after:avoid; }
  h4 { font-size:10.4pt; margin:12px 0 4px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em;
    break-after:avoid; }
  p { margin:0 0 7px; orphans:3; widows:3; }
  strong { font-weight:650; }
  hr { border:0; border-top:1px solid var(--line); margin:16px 0; }
  blockquote { margin:8px 0; padding:7px 12px; border-left:3px solid var(--accent); background:var(--soft);
    color:#2c2f36; break-inside:avoid; }
  ul,ol { margin:0 0 8px; padding-left:18px; }
  li { margin:2px 0; }
  a { color:#0b5f59; text-decoration:none; }
  .inline-doc { font-family:"Cascadia Mono","Consolas",monospace; font-size:8.6pt; color:#33363d; }
  code { font-family:"Cascadia Mono","Consolas",monospace; font-size:8.8pt; background:var(--soft);
    border:1px solid #e8eaf0; border-radius:3px; padding:0 3px; }
  pre.code { background:#fbfbfd; border:1px solid var(--line); border-radius:6px; padding:9px 11px;
    overflow:hidden; break-inside:avoid; }
  pre.code code { background:none; border:0; padding:0; font-size:8.4pt; line-height:1.45; }
  table { width:100%; border-collapse:collapse; margin:8px 0 12px; font-size:8.7pt; line-height:1.35; }
  thead { display:table-header-group; }
  th { text-align:left; background:#eef1f5; color:#1f2228; font-weight:650; border:1px solid var(--line);
    padding:5px 6px; vertical-align:bottom; }
  td { border:1px solid var(--line); padding:4.5px 6px; vertical-align:top; }
  tbody tr:nth-child(even) td { background:#fafbfd; }
  tr { break-inside:avoid; page-break-inside:avoid; }
  figure.figure { page:diagram; margin:0; padding:6px 4px 2px; border:1px solid var(--line);
    border-radius:8px; background:#fff; text-align:center;
    break-before:page; page-break-before:always; break-inside:avoid; page-break-inside:avoid; }
  figure.figure .mermaid { display:flex; justify-content:center; align-items:center; overflow:visible; }
  figure.figure svg { max-width:100% !important; height:auto !important; }
  figure.figure figcaption { margin-top:6px; font-size:8pt; letter-spacing:.12em; text-transform:uppercase;
    color:var(--muted); }
  .warn { color:#8a3a00; }
`;

const MERMAID_INIT = `
  window.__mermaidDone = false;
  (async () => {
    const els = [...document.querySelectorAll('.mermaid')];
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      fontFamily: '"Segoe UI", "Inter", system-ui, sans-serif',
      fontSize: 15,
      themeVariables: {
        background: '#ffffff', primaryColor: '#eef4f3', primaryBorderColor: '#0f766e',
        primaryTextColor: '#17181c', lineColor: '#6b7280', secondaryColor: '#f4f5f8',
        tertiaryColor: '#fbfbfd', clusterBkg: '#fbfbfd', clusterBorder: '#d9dce3',
        edgeLabelBackground: '#ffffff',
      },
      flowchart: { htmlLabels: true, useMaxWidth: true, nodeSpacing: 26, rankSpacing: 34, padding: 10 },
    });
    for (let i = 0; i < els.length; i++) {
      try {
        const { svg } = await mermaid.render('mmd' + i, els[i].textContent.trim());
        els[i].innerHTML = svg;
        const el = els[i].querySelector('svg');
        if (el) { el.removeAttribute('height'); el.style.maxWidth = '100%'; el.style.height = 'auto'; }
      } catch (e) {
        els[i].innerHTML = '<pre class="warn">diagram failed: ' + (e && e.message) + '</pre>';
      }
    }
    window.__mermaidDone = true;
  })();
`;

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  await ensureMermaid();

  let md = fs.readFileSync(SRC, 'utf8');
  // the cover carries the title; drop the duplicated leading H1 in the body
  md = md.replace(/^#\s+.*\r?\n/, '');

  const { body, toc } = renderMarkdown(md);
  const tocHtml = toc
    .filter((t) => t.depth >= 2 && t.depth <= 3)
    .map((t) => `<div class="toc-row toc-d${t.depth}"><a href="#${t.id}">${t.text}</a></div>`)
    .join('');
  const today = new Date().toISOString().slice(0, 10);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Platform load &amp; cost map — Firebase · Supabase · Cloudflare</title>
<style>${CSS}</style>
</head>
<body>
  <section class="cover">
    <div class="cover-top">
      <div class="cover-mark">MG</div>
      <div class="cover-kicker">MGHub · DPD Control Tower</div>
    </div>
    <div class="cover-main">
      <h1>Platform load &amp; cost map</h1>
      <div class="cover-rule"></div>
      <p class="sub">Firebase, Supabase and Cloudflare — what each layer is billed for, the measured read
      and write numbers behind it, what a performance drop looks like on each one, and the order to fix them.</p>
      <div class="cover-layers">
        <span class="cover-chip">Firebase · Firestore + Functions</span>
        <span class="cover-chip">Supabase · paused</span>
        <span class="cover-chip">Cloudflare · Workers + DO + R2</span>
      </div>
    </div>
    <div class="cover-meta">
      <b>Source</b> docs/perf/platform-load-map.md &nbsp;·&nbsp;
      <b>Runtime</b> musallam-delivery-prod &nbsp;·&nbsp;
      <b>Generated</b> ${today}
    </div>
  </section>

  <section class="toc">
    <h2>Contents</h2>
    ${tocHtml}
  </section>

  ${body}

  <script src="./mermaid.min.js"></script>
  <script>${MERMAID_INIT}</script>
</body>
</html>`;

  const htmlPath = path.join(WORK, 'platform-load-map.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({
    ...(chromePath ? { executablePath: chromePath } : { channel: 'chrome' }),
    args: ['--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForFunction('window.__mermaidDone === true', null, { timeout: 120_000 });

  const failed = await page.evaluate(
    "[...document.querySelectorAll('.warn')].map(e => e.textContent)",
  );
  if (failed.length) throw new Error(`mermaid render failed: ${failed.join(' | ')}`);

  // a diagram taller than the landscape page shrinks to fit instead of clipping
  await page.evaluate(() => {
    const maxH = 660;
    document.querySelectorAll('.mermaid svg').forEach((s) => {
      const b = s.getBoundingClientRect();
      if (b.height > maxH) {
        s.style.width = Math.round((b.width * maxH) / b.height) + 'px';
        s.style.maxWidth = 'none';
      }
    });
  });

  await page.pdf({
    path: OUT,
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate:
      '<div style="width:100%;font-size:7pt;color:#8a8f99;padding:0 12mm;font-family:Segoe UI,sans-serif;">Platform load &amp; cost map</div>',
    footerTemplate:
      '<div style="width:100%;font-size:7pt;color:#8a8f99;padding:0 12mm;font-family:Segoe UI,sans-serif;display:flex;justify-content:space-between;"><span>MGHub · DPD Control Tower</span><span class="pageNumber"></span></div>',
  });

  await browser.close();

  const bytes = fs.statSync(OUT).size;
  const mediaBoxes = [
    ...fs
      .readFileSync(OUT)
      .toString('latin1')
      .matchAll(/\/MediaBox\s*\[([^\]]+)\]/g),
  ].map((m) => m[1].trim());
  const landscape = mediaBoxes.filter((b) => {
    const [, , w, h] = b.split(/\s+/).map(Number);
    return w > h;
  }).length;

  console.log(
    `wrote ${path.relative(ROOT, OUT)} — ${mediaBoxes.length} pages (${landscape} landscape diagrams), ${(bytes / 1024).toFixed(0)} KB`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
