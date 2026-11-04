#!/usr/bin/env node
/**
 * Builds the client user manual as a Word document from docs/USER_MANUAL.md.
 *
 *   npm run docs:manual:docx
 *
 * The OOXML is written directly (jszip), so the .docx carries the same palette
 * as the PDF: navy headings and table headers, rust subheads and callout rules.
 * No screenshots, and no external converter required.
 */
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import JSZip from 'jszip';

const ROOT = process.cwd();

/** Which manual to build; pass `admin` as the first argument for the console-only manual. */
const DOCS = {
  user: {
    src: path.join(ROOT, 'docs', 'USER_MANUAL.md'),
    out: path.join(ROOT, 'docs', 'USER_MANUAL.docx'),
    title: 'MG-GO / Musallam Delivery',
    subtitle: 'User Manual',
    standfirst:
      'How riders use the MG-GO Android application — signing in, going on duty, recording deliveries, earnings, vehicle and support — and how the office console produces what they see.',
    chips: 'Rider app · Android     Admin console · web     English / العربية     Version 1.0',
    source: 'Written from the rider app and admin console source · No screenshots · English edition',
  },
  admin: {
    src: path.join(ROOT, 'docs', 'ADMIN_PANEL_MANUAL.md'),
    out: path.join(ROOT, 'docs', 'ADMIN_PANEL_MANUAL.docx'),
    title: 'MG-GO Admin Console',
    subtitle: 'Administrator User Manual',
    standfirst:
      'How operations, HR, payroll, fleet and administration staff run the delivery platform — employees and access, the live map, verification, requests, visits, signatures, fleet, pay and settings.',
    chips: 'Admin console · web     Rider app · Android     English / العربية     Version 1.0',
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

const NAVY = '27273F';
const RUST = 'A73C24';
const LINE = 'DCDFE5';
const SOFT = 'F5F6F8';
const WASH = 'FBF7F5';
const INK = '1B1C22';
const MUTED = '5B6068';

// A4 printable width in twips: (210mm - 2 x 16mm) = 178mm
const TEXT_TWIPS = 10091;

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function pStyle(id, name, pPr = '', rPr = '') {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/>${
    pPr ? `<w:pPr>${pPr}</w:pPr>` : ''
  }${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}</w:style>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
 <w:docDefaults>
  <w:rPrDefault><w:rPr>
   <w:rFonts w:ascii="Segoe UI" w:eastAsia="Segoe UI" w:hAnsi="Segoe UI" w:cs="Segoe UI"/>
   <w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="${INK}"/>
  </w:rPr></w:rPrDefault>
  <w:pPrDefault><w:pPr>
   <w:spacing w:after="140" w:line="276" w:lineRule="auto"/>
  </w:pPr></w:pPrDefault>
 </w:docDefaults>
 <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
 ${pStyle('CoverTitle', 'Cover Title', '<w:spacing w:after="60"/><w:keepNext/>', `<w:b/><w:sz w:val="60"/><w:szCs w:val="60"/><w:color w:val="${NAVY}"/>`)}
 ${pStyle('CoverSubtitle', 'Cover Subtitle', '<w:spacing w:after="240"/><w:keepNext/>', `<w:sz w:val="38"/><w:szCs w:val="38"/><w:color w:val="${RUST}"/>`)}
 ${pStyle('CoverKicker', 'Cover Kicker', '<w:spacing w:after="60"/>', `<w:b/><w:sz w:val="15"/><w:szCs w:val="15"/><w:color w:val="${MUTED}"/>`)}
 ${pStyle('CoverCopy', 'Cover Standfirst', '<w:spacing w:before="120" w:after="120"/>', '<w:sz w:val="23"/><w:szCs w:val="23"/><w:color w:val="3A3F47"/>')}
 ${pStyle('CoverMeta', 'Cover Meta', '<w:spacing w:before="240"/>', `<w:sz w:val="16"/><w:szCs w:val="16"/><w:color w:val="${MUTED}"/>`)}
 ${pStyle('Heading1', 'heading 1', `<w:spacing w:before="120" w:after="200"/><w:pageBreakBefore/><w:pBdr><w:bottom w:val="single" w:sz="18" w:space="4" w:color="${NAVY}"/></w:pBdr><w:outlineLvl w:val="0"/><w:keepNext/>`, `<w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="${NAVY}"/>`)}
 ${pStyle('Heading2', 'heading 2', '<w:spacing w:before="300" w:after="100"/><w:outlineLvl w:val="1"/><w:keepNext/>', `<w:b/><w:sz w:val="25"/><w:szCs w:val="25"/><w:color w:val="${NAVY}"/>`)}
 ${pStyle('Heading3', 'heading 3', '<w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/><w:keepNext/>', `<w:b/><w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="${RUST}"/>`)}
 ${pStyle('Quote', 'Callout', `<w:spacing w:before="120" w:after="200"/><w:ind w:left="113" w:right="113"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${RUST}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${WASH}"/>`, '<w:sz w:val="19"/><w:szCs w:val="19"/><w:color w:val="3A3F47"/>')}
 ${pStyle('CodeBlock', 'Code Block', `<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="113" w:right="113"/><w:shd w:val="clear" w:color="auto" w:fill="${SOFT}"/><w:keepLines/>`, '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/><w:szCs w:val="18"/>')}
 ${pStyle('ListParagraph', 'List Paragraph', '<w:spacing w:after="60"/>')}
 ${pStyle('TableText', 'Table Text', '<w:spacing w:before="40" w:after="40" w:line="252" w:lineRule="auto"/>', '<w:sz w:val="18"/><w:szCs w:val="18"/>')}
 ${pStyle('TableHead', 'Table Header', '<w:spacing w:before="40" w:after="40" w:line="252" w:lineRule="auto"/>', '<w:b/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="FFFFFF"/>')}
 ${pStyle('TocPart', 'Contents Part', '<w:spacing w:before="180" w:after="40"/><w:keepNext/>', `<w:b/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="${NAVY}"/>`)}
 ${pStyle('TocChapter', 'Contents Chapter', '<w:spacing w:after="36" w:line="264" w:lineRule="auto"/><w:ind w:left="227" w:hanging="227"/>', '<w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="3A3F47"/>')}
 <w:style w:type="character" w:styleId="InlineCode"><w:name w:val="Inline Code"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/><w:szCs w:val="19"/><w:color w:val="${INK}"/></w:rPr></w:style>
</w:styles>`;
}

function numberingXml() {
  const lvls = (fmt, text) =>
    [0, 1, 2]
      .map(
        (i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${340 + i * 340}" w:hanging="340"/></w:pPr></w:lvl>`,
      )
      .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
 <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('bullet', '\u2022')}</w:abstractNum>
 <w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('decimal', '%1.')}</w:abstractNum>
 <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
 <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
}

/* ------------------------------------------------------------------ *
 * inline runs
 * ------------------------------------------------------------------ */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;

function runs(text, { bold = false, color = null, size = null } = {}) {
  const out = [];
  const push = (chunk, { b = bold, code = false, italic = false } = {}) => {
    if (!chunk) return;
    const props = [];
    if (b) props.push('<w:b/>');
    if (italic) props.push('<w:i/>');
    if (code) props.push('<w:rStyle w:val="InlineCode"/>');
    if (size) props.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`);
    if (color) props.push(`<w:color w:val="${color}"/>`);
    out.push(
      `<w:r>${props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(chunk)}</w:t></w:r>`,
    );
  };

  const parts = String(text).split(INLINE);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**')) push(part.slice(2, -2), { b: true });
    else if (part.startsWith('`') && part.endsWith('`')) push(part.slice(1, -1), { code: true });
    else if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      push(part.slice(1, -1), { italic: true });
    else push(part);
  }
  return out.join('');
}

function para(inner, style = null, extraPPr = '') {
  const pPr = [style ? `<w:pStyle w:val="${style}"/>` : '', extraPPr].join('');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;
}

/* ------------------------------------------------------------------ *
 * tables
 * ------------------------------------------------------------------ */
function columnWidths(header, rows) {
  const count = header.length;
  const weights = new Array(count).fill(0);
  for (let c = 0; c < count; c += 1) {
    const samples = [header[c].text, ...rows.slice(0, 8).map((r) => r[c]?.text ?? '')];
    const avg = samples.reduce((sum, t) => sum + Math.min(String(t).length, 70), 0) / samples.length;
    weights[c] = Math.max(9, Math.min(52, avg));
  }
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.round((w / total) * TEXT_TWIPS));
  // make the rounding land exactly on the text width
  widths[widths.length - 1] += TEXT_TWIPS - widths.reduce((a, b) => a + b, 0);
  return widths;
}

function table(tok) {
  const rows = tok.rows.map((row) => row.map((cell) => ({ text: cell.text })));
  const widths = columnWidths(tok.header, tok.rows);
  const border = (side) =>
    `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${LINE}"/>`;

  const cell = (content, index, { head = false } = {}) =>
    `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/>${
      head ? `<w:shd w:val="clear" w:color="auto" w:fill="${NAVY}"/>` : ''
    }<w:tcMar><w:top w:w="52" w:type="dxa"/><w:bottom w:w="52" w:type="dxa"/><w:left w:w="85" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tcMar></w:tcPr>${para(
      runs(content, head ? { bold: true, color: 'FFFFFF', size: 18 } : { size: 18 }),
      head ? 'TableHead' : 'TableText',
    )}</w:tc>`;

  const headRow = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${tok.header
    .map((h, i) => cell(h.text, i, { head: true }))
    .join('')}</w:tr>`;

  const bodyRows = rows
    .map(
      (row, r) =>
        `<w:tr><w:trPr><w:cantSplit/>${r % 2 === 1 ? '<w:trHeight w:val="0"/>' : ''}</w:trPr>${row
          .map((c, i) => cell(c.text, i))
          .join('')}</w:tr>`,
    )
    .join('');

  return `<w:tbl><w:tblPr><w:tblW w:w="${TEXT_TWIPS}" w:type="dxa"/><w:tblBorders>${[
    'top',
    'left',
    'bottom',
    'right',
    'insideH',
    'insideV',
  ]
    .map(border)
    .join('')}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${widths
    .map((w) => `<w:gridCol w:w="${w}"/>`)
    .join('')}</w:tblGrid>${headRow}${bodyRows}</w:tbl>${para('')}`;
}

/* ------------------------------------------------------------------ *
 * block tokens
 * ------------------------------------------------------------------ */
function heading(tok) {
  const style = tok.depth === 2 ? 'Heading1' : tok.depth === 3 ? 'Heading2' : 'Heading3';
  return para(runs(tok.text), style);
}

function quote(tok) {
  const inner = tok.tokens
    .map((t) => (t.type === 'paragraph' ? para(runs(t.text), 'Quote') : ''))
    .join('');
  return inner;
}

function codeBlock(tok) {
  return tok.text
    .split(/\r?\n/)
    .map((line) => para(line ? runs(line) : '', 'CodeBlock'))
    .join('');
}

function list(tok, level = 0) {
  const numId = tok.ordered ? 2 : 1;
  return tok.items
    .map((item) => {
      const body = item.tokens
        .map((t) => (t.type === 'text' || t.type === 'paragraph' ? t.text : ''))
        .filter(Boolean)
        .join(' ');
      const indent = 340 + level * 340;
      const bullet = para(
        runs(body),
        'ListParagraph',
        `<w:numPr><w:ilvl w:val="${Math.min(level, 2)}"/><w:numId w:val="${numId}"/></w:numPr><w:ind w:left="${indent}" w:hanging="340"/>`,
      );
      const nested = item.tokens
        .filter((t) => t.type === 'list')
        .map((t) => list(t, level + 1))
        .join('');
      return bullet + nested;
    })
    .join('');
}

/* ------------------------------------------------------------------ *
 * package parts
 * ------------------------------------------------------------------ */
const RUN_MUTED = `<w:rPr><w:sz w:val="15"/><w:szCs w:val="15"/><w:color w:val="${MUTED}"/></w:rPr>`;

function headerXml(text) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
 <w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="${LINE}"/></w:pBdr><w:spacing w:after="0"/></w:pPr><w:r>${RUN_MUTED}<w:t>${esc(text)}</w:t></w:r></w:p>
</w:hdr>`;
}

function footerXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
 <w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="${TEXT_TWIPS}"/></w:tabs><w:spacing w:after="0"/></w:pPr>
  <w:r>${RUN_MUTED}<w:t>Version 1.0 · 4 November 2026</w:t></w:r>
  <w:r>${RUN_MUTED}<w:tab/></w:r>
  <w:r>${RUN_MUTED}<w:fldChar w:fldCharType="begin"/></w:r>
  <w:r>${RUN_MUTED}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
  <w:r>${RUN_MUTED}<w:fldChar w:fldCharType="separate"/></w:r>
  <w:r>${RUN_MUTED}<w:t>1</w:t></w:r>
  <w:r>${RUN_MUTED}<w:fldChar w:fldCharType="end"/></w:r>
 </w:p>
</w:ftr>`;
}

const emptyHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:hdr>`;

const emptyFooter = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:ftr>`;

const sectPr = `<w:sectPr>
 <w:headerReference w:type="default" r:id="rId3"/>
 <w:headerReference w:type="first" r:id="rId5"/>
 <w:footerReference w:type="default" r:id="rId4"/>
 <w:footerReference w:type="first" r:id="rId6"/>
 <w:titlePg/>
 <w:pgSz w:w="11906" w:h="16838"/>
 <w:pgMar w:top="1020" w:right="907" w:bottom="1020" w:left="907" w:header="567" w:footer="567" w:gutter="0"/>
</w:sectPr>`;

function coverXml() {
  return [
    para(runs('MUSALLAM GROUP · DELIVERY OPERATIONS'), 'CoverKicker'),
    para('', null, '<w:spacing w:before="2400"/>'),
    para(runs(DOC.title), 'CoverTitle'),
    para(runs(DOC.subtitle), 'CoverSubtitle'),
    para(runs(DOC.standfirst), 'CoverCopy'),
    para(runs(DOC.chips), 'CoverCopy'),
    para('', null, '<w:spacing w:before="6000"/>'),
    para(runs(DOC.source), 'CoverMeta'),
  ].join('');
}

/* ------------------------------------------------------------------ *
 * document assembly
 * ------------------------------------------------------------------ */
function documentXml(tokens) {
  const parts = [];

  // cover
  parts.push(coverXml());

  // contents: parts (H2) and chapters (H3)
  const headings = tokens.filter(
    (t) => t.type === 'heading' && (t.depth === 2 || t.depth === 3),
  );
  parts.push(para(runs('Contents'), 'Heading1'));
  for (const h of headings) {
    parts.push(para(runs(h.text), h.depth === 2 ? 'TocPart' : 'TocChapter'));
  }

  // document control: the table that follows the H1 in the markdown
  let start = 0;
  if (tokens[0]?.type === 'heading' && tokens[0].depth === 1) start = 1;
  if (tokens[start]?.type === 'table') {
    parts.push(para(runs('Document control'), 'Heading1'));
    parts.push(table(tokens[start]));
    start += 1;
  }

  // body
  for (const tok of tokens.slice(start)) {
    switch (tok.type) {
      case 'heading':
        if (tok.depth === 1) break; // the title lives on the cover
        parts.push(heading(tok));
        break;
      case 'paragraph':
        parts.push(para(runs(tok.text)));
        break;
      case 'table':
        parts.push(table(tok));
        break;
      case 'blockquote':
        parts.push(quote(tok));
        break;
      case 'code':
        parts.push(codeBlock(tok));
        break;
      case 'list':
        parts.push(list(tok));
        break;
      case 'hr':
        parts.push(
          para(
            '',
            null,
            `<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="${LINE}"/></w:pBdr>`,
          ),
        );
        break;
      case 'space':
        break;
      default:
        if (tok.raw) parts.push(para(runs(tok.raw)));
        break;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <w:body>${parts.join('\n')}${sectPr}</w:body>
</w:document>`;
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`missing source: ${SRC}`);
  const md = fs.readFileSync(SRC, 'utf8');
  const tokens = marked.lexer(md);

  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
 <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
 <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
 <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
 <Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
 <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
 <Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
 <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
 <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
 <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
  );

  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
 <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
 <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
 <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>
 <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>
</Relationships>`,
  );

  zip.file('word/document.xml', documentXml(tokens));
  zip.file('word/styles.xml', stylesXml());
  zip.file('word/numbering.xml', numberingXml());
  zip.file('word/header1.xml', headerXml(`${DOC.title} — ${DOC.subtitle}`));
  zip.file('word/header2.xml', emptyHeader);
  zip.file('word/footer1.xml', footerXml());
  zip.file('word/footer2.xml', emptyFooter);

  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <dc:title>${DOC.title} — ${DOC.subtitle}</dc:title>
 <dc:subject>Rider application and administration console</dc:subject>
 <dc:creator>MGHub</dc:creator>
 <cp:keywords>MG-GO, Musallam Delivery, rider app, admin console, user manual</cp:keywords>
 <dc:description>User manual written from the rider app and admin console source. No screenshots.</dc:description>
 <dcterms:created xsi:type="dcterms:W3CDTF">2026-11-04T00:00:00Z</dcterms:created>
 <dcterms:modified xsi:type="dcterms:W3CDTF">2026-11-04T00:00:00Z</dcterms:modified>
 <cp:revision>1</cp:revision>
</cp:coreProperties>`,
  );

  zip.file(
    'docProps/app.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
 <Application>MGHub docs pipeline</Application>
 <Company>Musallam Group</Company>
</Properties>`,
  );

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  fs.writeFileSync(OUT, buffer);

  const kb = (buffer.length / 1024).toFixed(0);
  const count = (t) => tokens.filter((x) => x.type === t).length;
  const entries = tokens.filter((t) => t.type === 'heading' && (t.depth === 2 || t.depth === 3)).length;
  console.log(
    `wrote ${path.relative(ROOT, OUT)} — ${kb} KB · ${count('table')} tables, ${count('heading')} headings, ${entries} contents entries`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});






