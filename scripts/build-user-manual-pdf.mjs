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
    chips: ['Rider app · Android', 'Admin console · web', 'English / العربية'],
    version: 'Version 1.0 · 4 Nov 2026',
    readerNote: 'Riders, operations staff and client stakeholders',
    rebuildNote: 'npm run docs:manual',
    source: 'Written from the rider app and admin console source · No screenshots · English edition',
  },
  admin: {
    src: path.join(ROOT, 'docs', 'ADMIN_PANEL_MANUAL.md'),
    out: path.join(ROOT, 'docs', 'ADMIN_PANEL_MANUAL.pdf'),
    title: 'MG-GO Admin Console',
    subtitle: 'Administrator User Manual',
    standfirst:
      'How operations, HR, payroll, fleet and administration staff run the delivery platform — employees and access, the live map, verification, requests, visits, signatures, fleet, pay and settings.',
    chips: ['Admin console · web', 'Rider app · Android', 'English / العربية'],
    version: 'Version 1.0 · 4 Nov 2026',
    readerNote: 'Administrators, HR, payroll, fleet and operations staff',
    rebuildNote: 'npm run docs:admin',
    source: 'Written from the admin console source · No screenshots · English edition',
  },
  stack: {
    src: path.join(ROOT, 'docs', 'TECH_STACK_OVERVIEW.md'),
    out: path.join(ROOT, 'docs', 'TECH_STACK_OVERVIEW.pdf'),
    title: 'MG-GO Admin Console',
    subtitle: 'Technical Stack Overview',
    standfirst:
      'The exact languages, frameworks, services and versions the platform runs on — console, functions, database, edge, hosting and the rider app — with the file every figure was read from.',
    chips: [
      'Next.js 16 · React 19',
      'Flutter 3.44 · Dart 3.12',
      'Firebase · Firestore',
    ],
    version: 'Version 1.5 · 11 Nov 2026',
    readerNote: 'Client technical stakeholders, onboarding engineers, procurement',
    rebuildNote: 'npm run docs:stack',
    source: 'Read from the MG-GO-Admin and MG-GO source trees · No estimates · English edition',
    /**
     * The stack document uses the two extra fence types the renderer below
     * understands: `metrics` for the summary tiles and `diagram` for the
     * inline architecture figures. In a markdown viewer they read as ordinary
     * code blocks, which keeps the source legible on GitHub.
     */
    diagrams: true,
  },
  architecture: {
    src: path.join(ROOT, 'docs', 'SYSTEM_ARCHITECTURE_OVERVIEW.md'),
    out: path.join(ROOT, 'docs', 'SYSTEM_ARCHITECTURE_OVERVIEW.pdf'),
    title: 'MGHub',
    subtitle: 'System Architecture & Technical Overview',
    standfirst:
      'The platform end to end — business modules, the Firestore data model, the payroll and synchronisation engines, every callable, route, cron and scheduled job, and the feature matrix that maps them to the screens operators use.',
    chips: ['Next.js 16 · Firestore', 'Cloud Functions gen2 · me-central1', 'Cloudflare DO · R2'],
    version: 'Version 1.0 · 13 Nov 2026',
    readerNote: 'Client technical stakeholders, architects, onboarding engineers',
    rebuildNote: 'npm run docs:architecture',
    source: 'Read from the MG-GO-Admin and MG-GO source trees · No placeholders · English edition',
    diagrams: true,
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

/* ------------------------------------------------------------------ *
 * Diagrams and metric tiles
 *
 * Both are authored as fenced blocks so the markdown stays readable in a
 * browser or on GitHub, and are replaced with real HTML only in the PDF.
 * The SVGs use a 900-unit viewBox, which renders at ~178 mm on A4 — so 13
 * units is roughly 7.3 pt, the size of body text in a table cell.
 * ------------------------------------------------------------------ */

const C = {
  navy: '#27273F',
  rust: '#A73C24',
  line: '#DCDFE5',
  line2: '#C7CBD3',
  soft: '#F5F6F8',
  mute: '#5B6068',
  teal: '#0F6F5C',
  white: '#FFFFFF',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function box({
  x,
  y,
  w,
  h,
  title,
  lines = [],
  tone = 'plain',
  titleSize = 13.5,
  lineSize = 11,
}) {
  const tones = {
    plain: { fill: C.white, stroke: C.line2, title: C.navy, body: C.mute },
    accent: { fill: C.navy, stroke: C.navy, title: C.white, body: '#D7D9E2' },
    soft: { fill: C.soft, stroke: C.line, title: C.navy, body: C.mute },
    rust: { fill: '#FDF4F1', stroke: C.rust, title: C.rust, body: '#6B4A40' },
  };
  const t = tones[tone] ?? tones.plain;
  const titleY = lines.length ? y + 22 : y + h / 2 + 4;
  const body = lines
    .map(
      (line, index) =>
        `<text x="${x + 12}" y="${y + 40 + index * 15}" font-size="${lineSize}" fill="${t.body}" font-family="Segoe UI, sans-serif">${esc(line)}</text>`,
    )
    .join('');
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${t.fill}" stroke="${t.stroke}" stroke-width="1"/>
    <text x="${x + 12}" y="${titleY}" font-size="${titleSize}" font-weight="600" fill="${t.title}" font-family="Segoe UI, sans-serif">${esc(title)}</text>
    ${body}
  </g>`;
}

function laneLabel(x, y, text) {
  return `<text x="${x}" y="${y}" font-size="9.5" letter-spacing="1.6" fill="${C.mute}" font-family="Segoe UI, sans-serif">${esc(
    text.toUpperCase(),
  )}</text>`;
}

function arrow(id, x1, y1, x2, y2, label, labelDx = 0) {
  const mid = label
    ? `<text x="${(x1 + x2) / 2 + labelDx}" y="${(y1 + y2) / 2 - 5}" font-size="10" fill="${C.mute}" text-anchor="middle" font-family="Segoe UI, sans-serif">${esc(label)}</text>`
    : '';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.line2}" stroke-width="1.3" marker-end="url(#${id}-arrow)"/>${mid}`;
}

function svgDefs(id) {
  return `<defs>
    <marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.line2}"/>
    </marker>
  </defs>`;
}

function figure(id, width, height, inner, caption) {
  return `<figure class="diagram">
  <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(caption)}">
    ${svgDefs(id)}
    ${inner}
  </svg>
  <figcaption>${caption}</figcaption>
</figure>`;
}

const DIAGRAMS = {};

/** §1 — the four layers, and what each one owns. */
DIAGRAMS.system = figure(
  'd-system',
  900,
  520,
  [
    laneLabel(24, 22, 'Clients'),
    box({
      x: 24,
      y: 32,
      w: 330,
      h: 78,
      title: 'Staff browser',
      lines: ['Admin console · EN / AR · 41 areas', 'React Server Components + client islands'],
    }),
    box({
      x: 372,
      y: 32,
      w: 328,
      h: 78,
      title: 'Rider app — MG-GO',
      lines: ['Flutter · Android · Google Play', 'Offline queue, GPS, camera, ML Kit'],
    }),

    laneLabel(24, 152, 'Serve'),
    box({
      x: 24,
      y: 162,
      w: 330,
      h: 78,
      title: 'Vercel · bom1',
      lines: ['Next.js 16.2.6 · RSC + server actions', '15 API groups · 13 cron jobs'],
      tone: 'accent',
    }),
    box({
      x: 372,
      y: 162,
      w: 328,
      h: 78,
      title: 'Cloudflare Workers',
      lines: ['dpd-live · dpd-images · dpd-esign-r2', 'Global edge, no origin hop'],
      tone: 'accent',
    }),

    laneLabel(24, 282, 'Compute'),
    box({
      x: 24,
      y: 292,
      w: 676,
      h: 78,
      title: 'Cloud Functions gen 2 · me-central1 · musallam-delivery-prod',
      lines: [
        'adminApi (light, 167) · adminApiScan (11) · adminApiHeavy (26) — 204 entries over 106 modules',
        'Every privileged read and write: permission slug, session epoch, Admin SDK',
      ],
      tone: 'rust',
    }),

    laneLabel(24, 412, 'Data'),
    box({
      x: 24,
      y: 422,
      w: 330,
      h: 78,
      title: 'Firestore · default · me-central2',
      lines: ['142 collections · 201 composite indexes', 'Deny-by-default rules, four client reads'],
    }),
    box({
      x: 372,
      y: 422,
      w: 328,
      h: 78,
      title: 'Cloudflare R2',
      lines: ['dpd-private-prod · documents, eSign, media', 'dpd-gps-prod · GPS archive'],
    }),

    box({
      x: 724,
      y: 32,
      w: 152,
      h: 164,
      title: 'Shared',
      lines: ['Firebase Auth', 'FCM push', 'Sentry', 'Cloud Scheduler'],
      tone: 'soft',
      titleSize: 12.5,
      lineSize: 10.5,
    }),

    arrow('d-system', 189, 110, 189, 160),
    arrow('d-system', 536, 110, 536, 160),
    arrow('d-system', 189, 240, 189, 290),
    arrow('d-system', 536, 240, 536, 290),
    arrow('d-system', 189, 370, 189, 420),
    arrow('d-system', 536, 370, 536, 420),
    `<line x1="700" y1="201" x2="724" y2="140" stroke="${C.line2}" stroke-width="1.3" stroke-dasharray="4 3" marker-end="url(#d-system-arrow)"/>`,
    `<line x1="700" y1="331" x2="724" y2="130" stroke="${C.line2}" stroke-width="1.3" stroke-dasharray="4 3"/>`,
  ].join('\n'),
  'The four layers. The console holds no database, the functions render no HTML, and the Workers never hold the only copy of anything.',
);

/** §1.2 — how one admin request resolves to a lane. */
DIAGRAMS.request = figure(
  'd-req',
  900,
  330,
  [
    box({ x: 20, y: 44, w: 160, h: 66, title: 'Admin page', lines: ['RSC · permission check'] }),
    box({ x: 20, y: 146, w: 160, h: 66, title: 'Server action', lines: ['or API route'] }),
    box({ x: 218, y: 146, w: 190, h: 66, title: 'callAdminFunction()', lines: ['name + payload'] }),
    box({ x: 446, y: 40, w: 150, h: 54, title: 'Light', lines: ['adminApi'] }),
    box({ x: 446, y: 108, w: 150, h: 54, title: 'Scan', lines: ['adminApiScan'] }),
    box({ x: 446, y: 176, w: 150, h: 54, title: 'Heavy', lines: ['adminApiHeavy'] }),
    box({ x: 630, y: 146, w: 120, h: 66, title: 'Callable', lines: ['same name'] }),
    box({ x: 784, y: 146, w: 96, h: 66, title: 'Firestore', lines: ['Admin SDK'] }),

    arrow('d-req', 100, 110, 100, 144, 'invoke'),
    arrow('d-req', 180, 179, 216, 179, ''),
    `<line x1="408" y1="179" x2="428" y2="179" stroke="${C.line2}" stroke-width="1.3"/>`,
    `<path d="M 428 43 L 428 203" stroke="${C.line2}" stroke-width="1.3" fill="none"/>`,
    `<path d="M 428 67 L 444 67" stroke="${C.line2}" stroke-width="1.3" marker-end="url(#d-req-arrow)"/>`,
    `<path d="M 428 135 L 444 135" stroke="${C.line2}" stroke-width="1.3" marker-end="url(#d-req-arrow)"/>`,
    `<path d="M 428 203 L 444 203" stroke="${C.line2}" stroke-width="1.3" marker-end="url(#d-req-arrow)"/>`,
    `<path d="M 596 67 L 614 67 L 614 144" stroke="${C.line2}" stroke-width="1.3" fill="none"/>`,
    `<path d="M 596 135 L 624 135 L 624 144" stroke="${C.line2}" stroke-width="1.3" fill="none"/>`,
    `<path d="M 596 203 L 634 203 L 634 214" stroke="${C.line2}" stroke-width="1.3" fill="none"/>`,
    arrow('d-req', 750, 179, 782, 179, ''),
    `<text x="428" y="228" font-size="9.8" fill="${C.mute}" text-anchor="middle" font-family="Segoe UI, sans-serif">laneOf(name)</text>`,
    `<text x="20" y="252" font-size="10" fill="${C.mute}" font-family="Segoe UI, sans-serif">lanes.ts is imported by both sides, so the client cannot look for a callable on a lane that does not serve it.</text>`,
  ].join('\n'),
  'One name, one lane. The client resolves the lane from the same file the server does, and each lane is a separate Cloud Run service with its own limits.',
);

/** §3.4 — the live-tracking path. */
DIAGRAMS.edge = figure(
  'd-edge',
  900,
  340,
  [
    box({ x: 18, y: 40, w: 190, h: 78, title: 'Rider app', lines: ['1 Hz position batch', 'batched 2 fixes / ≤2 s'] }),
    box({ x: 238, y: 40, w: 196, h: 78, title: 'dpd-live Worker', lines: ['/ingest · session check', 'replay frames are history-only'] }),
    box({
      x: 464,
      y: 40,
      w: 210,
      h: 78,
      title: 'FleetRoom DO',
      lines: ['SQLite · 10-min trails', 'viewport + filter culling'],
      tone: 'accent',
    }),
    box({ x: 704, y: 40, w: 178, h: 78, title: 'Admin map V2', lines: ['deck.gl · interpolated', '10 s poll fallback'] }),

    arrow('d-edge', 208, 79, 236, 79),
    arrow('d-edge', 434, 79, 462, 79),
    arrow('d-edge', 674, 79, 702, 79, 'deltas'),

    box({ x: 238, y: 210, w: 196, h: 78, title: 'Firestore', lines: ['driver_locations', 'fleet_events'] }),
    box({ x: 464, y: 210, w: 210, h: 78, title: 'R2 · dpd-gps-prod', lines: ['minute files, hourly', 'compacted per rider'] }),

    arrow('d-edge', 520, 118, 380, 208, 'duty path'),
    arrow('d-edge', 600, 118, 582, 208, 'archive'),

    `<text x="18" y="252" font-size="10" fill="${C.mute}" font-family="Segoe UI, sans-serif">A frame that arrives late is written as history, never replayed as a live position —</text>
     <text x="18" y="268" font-size="10" fill="${C.mute}" font-family="Segoe UI, sans-serif">otherwise a reconnecting phone walks its marker back through the last hour.</text>
     <text x="18" y="296" font-size="10" fill="${C.mute}" font-family="Segoe UI, sans-serif">If the WebSocket is down the console falls back to the Firestore snapshot poll and the</text>
     <text x="18" y="312" font-size="10" fill="${C.mute}" font-family="Segoe UI, sans-serif">connection pill says so, because a stale map that looks live is worse than an honest one.</text>`,
  ].join('\n'),
  'The live path. The Durable Object holds the fleet, the admin sees deltas, and durable state is flushed so a room restart is not a data loss.',
);

/** §5.2 — regions and residency. */
DIAGRAMS.regions = figure(
  'd-reg',
  900,
  300,
  [
    box({
      x: 20,
      y: 44,
      w: 254,
      h: 118,
      title: 'bom1 · Mumbai',
      lines: ['Vercel rendering', 'Next.js · RSC · API routes', 'Stateless — holds no database'],
      tone: 'soft',
    }),
    box({
      x: 306,
      y: 44,
      w: 254,
      h: 118,
      title: 'me-central1',
      lines: ['Cloud Functions gen 2', '3 router lanes · Cloud Scheduler', 'Every staff and rider write'],
      tone: 'rust',
    }),
    box({
      x: 592,
      y: 44,
      w: 288,
      h: 118,
      title: 'me-central2',
      lines: ['Firestore (default) · Firebase Auth', 'FCM · 142 collections', 'All persistent records'],
      tone: 'accent',
    }),
    arrow('d-reg', 276, 103, 304, 103, ''),
    arrow('d-reg', 562, 103, 590, 103, ''),

    `<rect x="306" y="196" width="574" height="62" rx="7" fill="${C.white}" stroke="${C.line2}" stroke-width="1" stroke-dasharray="5 4"/>`,
    `<text x="318" y="218" font-size="12.5" font-weight="600" fill="${C.navy}" font-family="Segoe UI, sans-serif">Cloudflare edge · global</text>`,
    `<text x="318" y="236" font-size="10.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">dpd-live (FleetRoom) · dpd-images · dpd-esign-r2 — with R2 dpd-private-prod / dpd-gps-prod held in the Middle East</text>`,

    `<text x="20" y="214" font-size="10.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">Only the renderer sits outside the</text>
     <text x="20" y="230" font-size="10.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">Middle East. No user data is stored</text>
     <text x="20" y="246" font-size="10.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">in the region that renders it.</text>`,
  ].join('\n'),
  'Regions and residency. Persistent data and the compute that touches it stay in the Middle East; Vercel is a stateless renderer in front of them.',
);

/* ------------------------------------------------------------------ *
 * SYSTEM_ARCHITECTURE_OVERVIEW figures
 * ------------------------------------------------------------------ */

/** §1.2 — the whole platform in four layers. */
DIAGRAMS['arch-platform'] = figure(
  'd-arch-platform',
  900,
  474,
  [
    laneLabel(20, 18, 'Clients'),
    box({
      x: 20,
      y: 28,
      w: 268,
      h: 74,
      title: 'Staff browser',
      lines: ['RSC pages · client islands', 'EN / AR, full RTL'],
      titleSize: 13,
      lineSize: 11,
    }),
    box({
      x: 306,
      y: 28,
      w: 268,
      h: 74,
      title: 'Rider app — MG-GO',
      lines: ['Flutter · Android', 'Offline queue · 1 Hz GPS'],
      titleSize: 13,
      lineSize: 11,
    }),
    box({
      x: 592,
      y: 28,
      w: 288,
      h: 74,
      title: 'Partner login',
      lines: ['client_portal.view only', 'Project-scoped, masked fields'],
      titleSize: 13,
      lineSize: 11,
    }),

    laneLabel(20, 128, 'Serve'),
    box({
      x: 20,
      y: 138,
      w: 860,
      h: 72,
      title: 'Vercel · bom1 — Next.js 16.2.6',
      lines: [
        'RSC render · server actions · 49 API routes · 13 cron routes · maxDuration 300 s on scan work',
        'Stateless: holds no database, no session store, no queue',
      ],
      tone: 'accent',
      titleSize: 13,
      lineSize: 11,
    }),

    laneLabel(20, 236, 'Compute'),
    box({
      x: 20,
      y: 246,
      w: 268,
      h: 78,
      title: 'adminApi · light',
      lines: ['2 GiB · conc 8 · 60 s', 'Default lane for every callable'],
      tone: 'rust',
      titleSize: 13,
      lineSize: 11,
    }),
    box({
      x: 306,
      y: 246,
      w: 268,
      h: 78,
      title: 'adminApiScan · scan',
      lines: ['4 GiB · conc 2 · 180 s', '19 unbounded readers'],
      tone: 'rust',
      titleSize: 13,
      lineSize: 11,
    }),
    box({
      x: 592,
      y: 246,
      w: 288,
      h: 78,
      title: 'adminApiHeavy · heavy',
      lines: ['4 GiB · conc 1 · 300 s', 'Purges · recalc · eSign compose'],
      tone: 'rust',
      titleSize: 13,
      lineSize: 11,
    }),

    laneLabel(20, 350, 'Data and edge'),
    box({
      x: 20,
      y: 360,
      w: 268,
      h: 80,
      title: 'Firestore · default',
      lines: ['142 collections', 'Deny-by-default rules'],
      titleSize: 13,
      lineSize: 11,
    }),
    box({
      x: 306,
      y: 360,
      w: 268,
      h: 80,
      title: 'Firebase Auth · FCM',
      lines: ['__session cookie · claims', 'Push per driver token'],
      titleSize: 13,
      lineSize: 11,
    }),
    box({
      x: 592,
      y: 360,
      w: 288,
      h: 80,
      title: 'Cloudflare · dpd-live + R2',
      lines: ['FleetRoom DO over WebSocket', 'dpd-private-prod · dpd-gps-prod'],
      titleSize: 13,
      lineSize: 11,
    }),

    arrow('d-arch-platform', 154, 102, 154, 136),
    arrow('d-arch-platform', 440, 102, 440, 136),
    arrow('d-arch-platform', 736, 102, 736, 136),
    arrow('d-arch-platform', 154, 210, 154, 244),
    arrow('d-arch-platform', 440, 210, 440, 244),
    arrow('d-arch-platform', 736, 210, 736, 244),
    arrow('d-arch-platform', 154, 324, 154, 358),
    arrow('d-arch-platform', 440, 324, 440, 358),
    arrow('d-arch-platform', 736, 324, 736, 358),

    `<text x="20" y="466" font-size="10.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">The rider app never holds an admin credential; the Worker never holds the only copy of a position; the console never reads Firestore directly.</text>`,
  ].join('\n'),
  'The platform in four layers. Every arrow is a real network hop: an HTTPS callable, a WebSocket frame, or an Admin SDK write.',
);

/** §3.1 — how one request becomes a permission decision. */
DIAGRAMS['arch-session'] = figure(
  'd-arch-session',
  900,
  292,
  [
    laneLabel(20, 20, 'One page request'),
    box({ x: 20, y: 30, w: 196, h: 96, title: '__session cookie', lines: ['Firebase session', 'verified in proxy.ts'], titleSize: 12.5, lineSize: 10.5 }),
    box({ x: 234, y: 30, w: 196, h: 96, title: 'proxy.ts', lines: ['3 s probe', 'maintenance + claim', 'fails open on timeout'], titleSize: 12.5, lineSize: 10.5 }),
    box({ x: 448, y: 30, w: 196, h: 96, title: 'resolvePanelAuth', lines: ['20 s verify,', 'one 25 s retry', 'SessionRecover on doubt'], titleSize: 12.5, lineSize: 10.5 }),
    box({ x: 662, y: 30, w: 218, h: 96, title: 'loadReadSession', lines: ['profiles + auth_epochs', 'in one getAll', 'epoch keys the cache'], titleSize: 12.5, lineSize: 10.5 }),

    arrow('d-arch-session', 216, 78, 232, 78),
    arrow('d-arch-session', 430, 78, 446, 78),
    arrow('d-arch-session', 644, 78, 660, 78),

    laneLabel(20, 168, 'Permission resolution'),
    box({
      x: 20,
      y: 178,
      w: 276,
      h: 84,
      title: 'access_kind = manager',
      lines: ['admin_permissions/catalog', 'union the code catalog', '→ full set'],
      tone: 'soft',
      titleSize: 12.5,
      lineSize: 10.5,
    }),
    box({
      x: 312,
      y: 178,
      w: 276,
      h: 84,
      title: 'access_kind = user',
      lines: ['admin_user_permissions ticks', 'else role slugs', '→ narrowed set'],
      tone: 'soft',
      titleSize: 12.5,
      lineSize: 10.5,
    }),
    box({
      x: 604,
      y: 178,
      w: 276,
      h: 84,
      title: 'access_kind = partner',
      lines: ['client_portal.view', 'operations_dashboard.view', 'callable allowlist of 6'],
      tone: 'soft',
      titleSize: 12.5,
      lineSize: 10.5,
    }),
    arrow('d-arch-session', 771, 126, 771, 176),
    arrow('d-arch-session', 158, 126, 158, 176),

    `<text x="20" y="284" font-size="10.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">hasPermissionInSet(slugs, slug, isSuperAdmin) is the only gate a page or a callable consults. A role, tick or catalog write bumps auth_epochs, so the next request rebuilds rather than serving a stale set.</text>`,
  ].join('\n'),
  'Session to permission in one pass. A slow or unreachable Auth backend resolves to SessionRecover — an unproven session is never treated as a signed-out one.',
);

/** §3.3 — the two payroll engines, side by side. */
DIAGRAMS['arch-payroll'] = figure(
  'd-arch-payroll',
  900,
  412,
  [
    laneLabel(20, 18, 'Payroll Hub — month grid'),
    box({ x: 20, y: 28, w: 424, h: 306, title: 'Day classification', lines: [], tone: 'soft', titleSize: 13 }),
    box({ x: 36, y: 58, w: 180, h: 62, title: 'Inputs', lines: ['attendance_logs', 'leave plans · recon', 'payroll_day_hours'], titleSize: 11.5, lineSize: 10 }),
    box({ x: 246, y: 58, w: 182, h: 62, title: 'evalDay()', lines: ['hand edit > cover >', 'client rule > default'], titleSize: 11.5, lineSize: 10 }),
    box({ x: 36, y: 148, w: 180, h: 62, title: 'DayStatus', lines: ['12 / 6 / 3 hours', 'OFF · Sick · ABS · Cancel'], titleSize: 11.5, lineSize: 10 }),
    box({ x: 246, y: 148, w: 182, h: 62, title: 'requiredHoursFor()', lines: ['(monthDays − offDays) × 12', 'prorated for a range'], titleSize: 11.5, lineSize: 10 }),
    box({ x: 36, y: 238, w: 392, h: 76, title: 'Grid + Excel', lines: ['56 columns in screen order · palette fills', 'append-only undo, last 20 batches', 'Efficiency = actual ÷ required'], tone: 'accent', titleSize: 12.5, lineSize: 10.5 }),
    arrow('d-arch-payroll', 226, 89, 244, 89),
    arrow('d-arch-payroll', 126, 120, 126, 146),
    arrow('d-arch-payroll', 337, 120, 337, 146),
    arrow('d-arch-payroll', 126, 210, 126, 236),
    arrow('d-arch-payroll', 337, 210, 337, 236),

    laneLabel(476, 18, 'HR Payroll sheet'),
    box({ x: 476, y: 28, w: 404, h: 306, title: 'Computed per rider-month', lines: [], tone: 'soft', titleSize: 13 }),
    box({ x: 492, y: 58, w: 372, h: 62, title: 'computeHrPayroll()', lines: ['hourly = fixed ÷ F. working hours', 'efficiency = rider DPD ÷ restaurant DPD'], titleSize: 11.5, lineSize: 10 }),
    box({ x: 492, y: 136, w: 372, h: 62, title: 'Earnings lines', lines: ['salary as per hours · 2 Y · 4 Y', 'food · incentives · sick reimbursement'], titleSize: 11.5, lineSize: 10 }),
    box({ x: 492, y: 214, w: 372, h: 62, title: 'Deductions', lines: ['traffic violations · loan', 'other deductions'], titleSize: 11.5, lineSize: 10 }),
    box({ x: 492, y: 292, w: 372, h: 30, title: 'Payment = Total Salary', lines: [], tone: 'accent', titleSize: 11.5 }),
    arrow('d-arch-payroll', 678, 120, 678, 134),
    arrow('d-arch-payroll', 678, 198, 678, 212),
    arrow('d-arch-payroll', 678, 276, 678, 290),

    `<text x="20" y="358" font-size="10.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">Unapproved month: calculated cells render the awaiting sentinel as — on screen and "Awaiting approval" in Excel. Read-only identity columns mirror drivers and are never computed here.</text>`,
    `<text x="20" y="378" font-size="10.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">A stored vehicle / project / zone rate turns approved orders into revenue and contribution; a hand edit writes an append-only row and recomputes dependants immediately.</text>`,
  ].join('\n'),
  'Two engines, deliberately separate: the month grid decides what a day was, HR Payroll prices the month. Neither recalculates the other.',
);

/** §2 — the core entity graph, read as a hub. */
DIAGRAMS['arch-entities'] = figure(
  'd-arch-entities',
  900,
  440,
  [
    laneLabel(20, 16, 'Identity and organisation'),
    box({ x: 30, y: 30, w: 230, h: 62, title: 'profiles', lines: ['role · access_kind · approval'], titleSize: 12, lineSize: 10 }),
    box({ x: 335, y: 30, w: 230, h: 62, title: 'payroll_clients', lines: ['key · hour values · rules'], titleSize: 12, lineSize: 10 }),
    box({ x: 640, y: 30, w: 232, h: 62, title: 'restaurants', lines: ['partner_id · zone_id'], titleSize: 12, lineSize: 10 }),

    box({ x: 30, y: 158, w: 230, h: 62, title: 'vehicles', lines: ['plate · type · odometer'], titleSize: 12, lineSize: 10 }),
    box({ x: 335, y: 158, w: 230, h: 80, title: 'drivers', lines: ['employee_id · status · zone_id', 'project_key · vehicle_id'], tone: 'accent', titleSize: 13, lineSize: 10.5 }),
    box({ x: 640, y: 158, w: 232, h: 62, title: 'deliveries', lines: ['status · shift_date'], titleSize: 12, lineSize: 10 }),

    box({ x: 100, y: 296, w: 220, h: 62, title: 'zones', lines: ['geometry · colour'], titleSize: 12, lineSize: 10 }),
    box({ x: 340, y: 296, w: 220, h: 62, title: 'requests · esign_requests', lines: ['RCM-#### · SIG-####'], titleSize: 12, lineSize: 10 }),
    box({ x: 580, y: 296, w: 220, h: 62, title: 'attendance_logs', lines: ['log_date · check in/out'], titleSize: 12, lineSize: 10 }),

    `<line x1="145" y1="92" x2="145" y2="156" stroke="${C.line2}" stroke-width="1.3" marker-end="url(#d-arch-entities-arrow)"/>`,
    `<line x1="260" y1="189" x2="333" y2="196" stroke="${C.line2}" stroke-width="1.3" marker-end="url(#d-arch-entities-arrow)"/>`,
    `<line x1="565" y1="196" x2="638" y2="189" stroke="${C.line2}" stroke-width="1.3" marker-end="url(#d-arch-entities-arrow)"/>`,
    `<line x1="450" y1="92" x2="450" y2="156" stroke="${C.line2}" stroke-width="1.3" marker-end="url(#d-arch-entities-arrow)"/>`,
    `<line x1="450" y1="238" x2="450" y2="294" stroke="${C.line2}" stroke-width="1.3" marker-end="url(#d-arch-entities-arrow)"/>`,
    `<line x1="210" y1="220" x2="210" y2="294" stroke="${C.line2}" stroke-width="1.3" marker-end="url(#d-arch-entities-arrow)"/>`,
    `<line x1="565" y1="220" x2="690" y2="294" stroke="${C.line2}" stroke-width="1.3" marker-end="url(#d-arch-entities-arrow)"/>`,

    `<text x="150" y="126" font-size="9.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">1:1</text>`,
    `<text x="288" y="182" font-size="9.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">1:1 holder</text>`,
    `<text x="580" y="182" font-size="9.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">1:N</text>`,
    `<text x="456" y="128" font-size="9.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">1:N project</text>`,
    `<text x="456" y="272" font-size="9.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">1:N</text>`,
    `<text x="216" y="262" font-size="9.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">1:N</text>`,
    `<text x="600" y="262" font-size="9.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">1:N</text>`,

    `<rect x="100" y="382" width="700" height="46" rx="7" fill="${C.soft}" stroke="${C.line}" stroke-width="1"/>`,
    `<text x="114" y="402" font-size="10.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">M:N junctions: driver_restaurants · driver_intake_restaurants · delivery_rule_scopes · esign_request_signers</text>`,
    `<text x="114" y="419" font-size="10.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">Derived and denormalised: rollups_driver_day · rollups_zone_month · driver_locations (one doc) · rider_signals</text>`,
  ].join('\n'),
  'The core graph. Everything the console lists hangs off drivers; everything the rider files hangs off drivers too, which is why one identity fix corrects a dozen screens.',
);

/** §1.3 — the admin console, high level: four layers and how they talk. */
DIAGRAMS['admin-arch'] = figure(
  'd-admin-arch',
  900,
  372,
  [
    laneLabel(20, 20, 'Access'),
    laneLabel(240, 20, 'Serve'),
    laneLabel(460, 20, 'Compute'),
    laneLabel(680, 20, 'Data'),

    box({
      x: 20,
      y: 30,
      w: 200,
      h: 118,
      title: 'Staff browser',
      lines: ['Admin console · 41 areas', 'English / العربية, full RTL', 'React 19 client islands'],
      titleSize: 14,
      lineSize: 12,
    }),
    box({
      x: 240,
      y: 30,
      w: 200,
      h: 118,
      title: 'Vercel · bom1',
      lines: ['RSC pages + server actions', '15 API route groups', '13 cron jobs'],
      tone: 'accent',
      titleSize: 14,
      lineSize: 12,
    }),
    box({
      x: 460,
      y: 30,
      w: 200,
      h: 118,
      title: 'Cloud Functions',
      lines: ['gen 2 · me-central1', '3 lanes: light / scan / heavy', 'permission + session epoch'],
      tone: 'rust',
      titleSize: 14,
      lineSize: 12,
    }),
    box({
      x: 680,
      y: 30,
      w: 200,
      h: 118,
      title: 'Firestore',
      lines: ['default · me-central2', '142 collections', 'deny-by-default rules'],
      titleSize: 14,
      lineSize: 12,
    }),

    arrow('d-admin-arch', 220, 89, 238, 89),
    arrow('d-admin-arch', 440, 89, 458, 89, 'HTTPS'),
    arrow('d-admin-arch', 660, 89, 678, 89, 'Admin SDK'),

    laneLabel(20, 190, 'Shared services'),
    box({
      x: 20,
      y: 198,
      w: 200,
      h: 112,
      title: 'Sentry',
      lines: ['dpd-admin', 'errors, breadcrumbs', 'release = deployed commit'],
      tone: 'soft',
      titleSize: 13,
      lineSize: 11.5,
    }),
    box({
      x: 240,
      y: 198,
      w: 200,
      h: 112,
      title: 'Cloudflare Workers',
      lines: ['dpd-live · FleetRoom', 'dpd-images', 'dpd-esign-r2'],
      tone: 'soft',
      titleSize: 13,
      lineSize: 11.5,
    }),
    box({
      x: 460,
      y: 198,
      w: 200,
      h: 112,
      title: 'Cloudflare R2',
      lines: ['dpd-private-prod', 'dpd-gps-prod'],
      tone: 'soft',
      titleSize: 13,
      lineSize: 11.5,
    }),
    box({
      x: 680,
      y: 198,
      w: 200,
      h: 112,
      title: 'Firebase Auth · FCM',
      lines: ['staff email / password', 'push to the rider app'],
      tone: 'soft',
      titleSize: 13,
      lineSize: 11.5,
    }),

    `<line x1="250" y1="148" x2="150" y2="196" stroke="${C.line2}" stroke-width="1.3" stroke-dasharray="4 3" marker-end="url(#d-admin-arch-arrow)"/>`,
    `<line x1="340" y1="148" x2="340" y2="196" stroke="${C.line2}" stroke-width="1.3" stroke-dasharray="4 3" marker-end="url(#d-admin-arch-arrow)"/>`,
    `<line x1="560" y1="148" x2="560" y2="196" stroke="${C.line2}" stroke-width="1.3" stroke-dasharray="4 3" marker-end="url(#d-admin-arch-arrow)"/>`,
    `<path d="M 660 120 L 780 120 L 780 196" fill="none" stroke="${C.line2}" stroke-width="1.3" stroke-dasharray="4 3" marker-end="url(#d-admin-arch-arrow)"/>`,

    `<text x="20" y="344" font-size="11.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">Solid arrows are the browser's request path; dashed arrows are services reached from the functions and the page shell.</text>`,
    `<text x="20" y="362" font-size="11.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">No arrow skips a layer: the browser has no route to Firestore, and the functions render no HTML.</text>`,
  ].join('\n'),
  'The admin console, high level. Four layers — access, serve, compute, data — and the shared managed services each of them uses.',
);

/** §1.3 — the rider app, high level: offline-first, three doors to the backend. */
DIAGRAMS['app-arch'] = figure(
  'd-app-arch',
  900,
  430,
  [
    laneLabel(20, 20, 'On the phone'),
    laneLabel(300, 20, 'Backend doors'),
    laneLabel(580, 20, 'Persistent state'),

    box({
      x: 20,
      y: 90,
      w: 250,
      h: 180,
      title: 'Rider app · Flutter',
      lines: [
        '21 feature modules',
        'Riverpod state + go_router',
        'offline queue — SQLite v10',
        'GPS · camera · on-device ML',
        'English / العربية, full RTL',
        'Android only · Google Play',
        'no sideload · developer options refused',
      ],
      tone: 'accent',
      titleSize: 14,
      lineSize: 11.5,
    }),

    box({
      x: 300,
      y: 48,
      w: 250,
      h: 78,
      title: 'Sign-in',
      lines: ['passcode → custom token', 'single-device heartbeat'],
      titleSize: 14,
      lineSize: 12,
    }),
    box({
      x: 300,
      y: 142,
      w: 250,
      h: 78,
      title: 'driver* callables',
      lines: ['duty, deliveries, requests', 'earnings, e-sign, visits'],
      titleSize: 14,
      lineSize: 12,
    }),
    box({
      x: 300,
      y: 236,
      w: 250,
      h: 78,
      title: 'dpd-live Worker',
      lines: ['GPS over WebSocket', '4 Hz fleet fan-out'],
      tone: 'rust',
      titleSize: 14,
      lineSize: 12,
    }),

    box({
      x: 580,
      y: 48,
      w: 300,
      h: 78,
      title: 'Firebase Auth · FCM',
      lines: ['session, push tokens', 'project musallam-delivery-prod'],
      titleSize: 14,
      lineSize: 12,
    }),
    box({
      x: 580,
      y: 142,
      w: 300,
      h: 78,
      title: 'Firestore · me-central2',
      lines: ["the rider's own drivers row", 'everything else via a callable'],
      titleSize: 14,
      lineSize: 12,
    }),
    box({
      x: 580,
      y: 236,
      w: 300,
      h: 78,
      title: 'Cloudflare R2',
      lines: ['photos, eSign, attachments', 'presigned, short-lived'],
      titleSize: 14,
      lineSize: 12,
    }),

    arrow('d-app-arch', 270, 90, 298, 90),
    arrow('d-app-arch', 270, 181, 298, 181),
    arrow('d-app-arch', 270, 272, 298, 272, 'live GPS'),
    arrow('d-app-arch', 550, 87, 578, 87, 'session'),
    arrow('d-app-arch', 550, 275, 578, 275, 'uploads'),
    arrow('d-app-arch', 550, 181, 578, 181, 'read + write'),

    `<text x="20" y="330" font-size="11.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">Offline first: a duty change, a pickup or a completed delivery is written to the local SQLite queue and drained when</text>`,
    `<text x="20" y="348" font-size="11.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">connectivity returns, so a delivery finished in a dead zone is not lost. The queue is the reason the app can be used</text>`,
    `<text x="20" y="366" font-size="11.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">in a basement, and the reason every write carries an id so a retry cannot double count.</text>`,
    `<text x="20" y="392" font-size="11.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">Documents leave the phone only through the admin API's presigned-upload route — the app never holds a bucket key.</text>`,
    `<text x="20" y="410" font-size="11.5" fill="${C.mute}" font-family="Segoe UI, sans-serif">Attachment and eSign PDFs are read back the same way, by short-lived signed URL.</text>`,
  ].join('\n'),
  'The rider app, high level. Offline-first on the phone, and three separate doors to the same backend — session, callables, edge.',
);

function renderMetrics(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('|').map((part) => part.trim()));
  const tiles = rows
    .map(([label = '', value = '', note = '']) => {
      return `<div class="metric"><div class="k">${esc(label)}</div><div class="v">${esc(value)}</div><div class="n">${esc(note)}</div></div>`;
    })
    .join('\n');
  return `<div class="metrics">\n${tiles}\n</div>\n`;
}


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
        /**
         * A numbered section heading (`## 3. Backend`) gets a chip for the
         * number rather than the bare "3." at the start of the line — that is
         * what makes a 20-page technical document scannable.
         */
        if (token.depth === 2) {
          const numbered = /^(\d+)\.\s+(.*)$/.exec(plain);
          if (numbered) {
            return `<h2 id="${id}"><span class="sec-no">${numbered[1]}</span><span class="sec-text">${numbered[2]}</span></h2>\n`;
          }
        }
        return `<h${token.depth} id="${id}">${inline}</h${token.depth}>\n`;
      },
      code(token) {
        const lang = (token.lang ?? '').trim().toLowerCase();
        if (DOC.diagrams && lang === 'metrics') return renderMetrics(token.text);
        if (DOC.diagrams && lang === 'diagram') {
          const id = token.text.trim();
          if (DIAGRAMS[id]) return DIAGRAMS[id];
        }
        if (DOC.diagrams && lang === 'mermaid') {
          // A Mermaid block may name a crafted figure on its first line:
          //   %% diagram: arch-platform
          // Mermaid treats `%%` as a comment, so GitHub renders the graph and the
          // PDF renders the vector figure — one source, two correct outputs.
          const key = /^%%\s*diagram:\s*([A-Za-z0-9_-]+)/.exec(token.text)?.[1];
          if (key && DIAGRAMS[key]) return DIAGRAMS[key];
        }
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
  @page { size: A4 portrait; margin: 18mm 16mm 16mm; }
  /* A dependency map is read, not skimmed, and at 178 mm its labels shrink
     below 5 pt. It gets a landscape page of its own instead: 267 mm of width
     is 1.5× the portrait column, which is the difference between a diagram
     and a grey rectangle. */
  @page wide { size: A4 landscape; margin: 14mm; }
  body {
    font-family:"Segoe UI","Inter",system-ui,-apple-system,sans-serif;
    color:var(--ink); font-size:10.2pt; line-height:1.55;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }

  /* ---------- cover ---------- */
  .cover { height:297mm; padding:18mm 16mm 14mm; display:flex; flex-direction:column; justify-content:space-between;
    break-after:page; page-break-after:always; position:relative; }
  .cover-grid { position:absolute; inset:0; pointer-events:none;
    background-image:linear-gradient(to right, rgba(39,39,63,.06) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(39,39,63,.06) 1px, transparent 1px);
    background-size:14mm 14mm;
    -webkit-mask-image:linear-gradient(to bottom, rgba(0,0,0,.9), transparent);
    mask-image:linear-gradient(to bottom, rgba(0,0,0,.9), transparent); }
  .cover-top { display:flex; align-items:center; gap:10px; position:relative; }
  .cover-mark { width:34px; height:34px; border-radius:9px; background:var(--navy); color:#fff;
    font-weight:700; font-size:13px; letter-spacing:.02em; display:flex; align-items:center; justify-content:center; }
  .cover-kicker { font-size:8pt; letter-spacing:.2em; text-transform:uppercase; color:var(--muted); }
  .cover-main { margin-top:34mm; position:relative; }
  .cover h1 { font-size:31pt; line-height:1.08; margin:0 0 6px; letter-spacing:-.015em; font-weight:700; }
  .cover h2 { font-size:19pt; margin:0 0 22px; font-weight:400; color:var(--rust); border:0; padding:0;
    break-before:auto; page-break-before:auto; }
  .cover-rule { height:3px; width:62px; background:var(--rust); margin:0 0 20px; }
  .cover .standfirst { font-size:11.5pt; color:#3a3f47; max-width:132mm; margin:0; }
  .cover-chips { display:flex; flex-wrap:wrap; gap:7px; margin-top:26px; }
  .chip { font-size:8pt; color:#3a3f47; border:1px solid var(--line); border-radius:999px; padding:4px 10px; background:var(--soft); }
  .cover-foot { position:relative; display:flex; justify-content:space-between; align-items:flex-end; gap:16px;
    border-top:1px solid var(--line); padding-top:9px; }
  .cover-meta { font-size:8pt; color:var(--muted); max-width:120mm; line-height:1.45; }
  .cover-badge { font-size:8pt; font-weight:700; color:var(--navy); border:1px solid var(--navy);
    border-radius:999px; padding:4px 11px; white-space:nowrap; }

  /* ---------- contents ---------- */
  /* A contents page that stops two-thirds down looks like a page that failed
     to render. It gets a masthead, a two-column list, and a fact strip closing
     the page — the same three-fact rhythm the rest of the document uses. */
  .toc { break-after:page; page-break-after:always; display:flex; flex-direction:column;
    min-height:248mm; }
  .toc-eyebrow { font-size:7.6pt; letter-spacing:.18em; text-transform:uppercase;
    color:var(--muted); margin:0 0 7px; }
  .toc-title { font-size:23pt; font-weight:700; color:var(--navy); margin:0 0 9px;
    letter-spacing:-.012em; break-before:auto; page-break-before:auto; }
  .toc-rule { height:3px; width:54px; background:var(--rust); margin:0 0 16px; }
  .toc ol { list-style:none; margin:0; padding:0; columns:2; column-gap:12mm; }
  .toc li { margin:0; break-inside:avoid; }
  .toc .lvl2 { margin:8px 0 3px; font-weight:700; font-size:9.6pt; color:var(--navy); }
  .toc .lvl3 { margin:0 0 0 12px; font-size:8.8pt; color:#3a3f47; }
  .toc .lvl3 a::before { content:"· "; color:var(--rust); }
  .toc a { color:inherit; text-decoration:none; }
  .toc-facts { margin-top:auto; padding-top:11px; border-top:1px solid var(--line);
    display:grid; grid-template-columns:repeat(3, 1fr); gap:10px 14px; }
  .toc-figures { margin-top:16px; }
  .toc-sub { font-size:7.4pt; letter-spacing:.14em; text-transform:uppercase;
    color:var(--muted); margin:0 0 6px; font-weight:600; }
  .toc-figures ol { columns:2; column-gap:12mm; margin:0; padding:0; list-style:none; }
  .toc-figures li { font-size:8.4pt; line-height:1.35; color:#3a3f47; margin:0 0 3px;
    break-inside:avoid; padding-left:16px; position:relative; }
  .toc-figures .fig-no { position:absolute; left:0; top:0; font-size:7.4pt; font-weight:700;
    color:var(--rust); }
  .toc-facts div { font-size:8.5pt; line-height:1.4; color:#3a3f47; }
  .toc-facts b { display:block; font-size:7.1pt; letter-spacing:.09em; text-transform:uppercase;
    color:var(--muted); font-weight:600; margin-bottom:2px; }

  /* ---------- body ---------- */
  h1, h2, h3, h4 { break-after:avoid; page-break-after:avoid; }
  h2 { font-size:16pt; margin:0 0 12px; padding-bottom:7px; border-bottom:2px solid var(--navy);
    color:var(--navy); break-before:page; page-break-before:always; }
  h2:first-of-type { break-before:auto; page-break-before:auto; }
  h2 .sec-no { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px;
    border-radius:5px; background:var(--navy); color:#fff; font-size:9.5pt; font-weight:700;
    margin-right:8px; vertical-align:3px; letter-spacing:0; }
  h3 { font-size:12.6pt; margin:20px 0 8px; color:var(--navy); }
  h4 { font-size:10.6pt; margin:14px 0 6px; color:var(--rust); letter-spacing:.01em; }
  p { margin:0 0 8px; }
  ul, ol { margin:0 0 10px; padding-left:18px; }
  li { margin:0 0 4px; break-inside:avoid; }
  strong { font-weight:700; }
  em { font-style:italic; color:#3a3f47; }
  a { color:var(--rust); text-decoration:none; }

  /* A long URL (a shared folder link, a bucket name) must wrap instead of
     running past the right page edge. */
  p, li, td, th, a { overflow-wrap:anywhere; word-break:break-word; }

  /* ---------- metric tiles (the "at a glance" block) ---------- */
  .metrics { display:grid; grid-template-columns:repeat(3, 1fr); gap:7px; margin:10px 0 16px; }
  .metric { border:1px solid var(--line); border-radius:9px; padding:8px 10px 9px;
    background:linear-gradient(180deg,#fff 0%,#fafafb 100%); break-inside:avoid; }
  .metric .k { font-size:7.2pt; letter-spacing:.09em; text-transform:uppercase; color:var(--muted); }
  .metric .v { font-size:12.2pt; font-weight:700; color:var(--navy); margin:2px 0 1px; letter-spacing:-.01em; }
  .metric .n { font-size:7.6pt; line-height:1.35; color:#4a4f57; }

  /* ---------- architecture figures ---------- */
  figure.diagram { margin:8px 0 16px; padding:10px 12px 0; border:1px solid var(--line);
    border-radius:9px; background:#fff; break-inside:avoid; page-break-inside:avoid; }
  figure.diagram svg { display:block; width:100%; height:auto; }
  figure.diagram figcaption { font-size:8.2pt; line-height:1.4; color:var(--muted);
    border-top:1px dashed var(--line); margin-top:4px; padding:7px 2px 9px; }

  /* ---------- plates: the two module dependency maps ---------- */
  figure.plate { margin:0; padding:0; border:0; page:wide; break-before:page; break-after:page; }
  figure.plate img { display:block; width:100%; height:auto; border:1px solid var(--line);
    border-radius:6px; background:#fff; }
  figure.plate figcaption { margin-top:7px; font-size:8.4pt; line-height:1.45; color:var(--muted); }
  figure.plate figcaption b { color:var(--navy); font-weight:700; }
  .plate-lead { page:wide; break-before:page; margin:0 0 6px; }
  .plate-lead h3 { margin-top:0; }

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

/**
 * Turns a standalone image paragraph into a landscape plate, and numbers every
 * figure in body order.
 *
 * Markdown keeps the diagram as an ordinary image so it also renders on GitHub;
 * only the PDF gives it a page of its own, a caption and a number. Relative
 * `src` paths are resolved against the repo root because the print HTML lives in
 * a temp directory, where a relative path would not resolve.
 */
function renderPlates(html) {
  const withFigures = html.replace(/<p>\s*<img\b([^>]*?)>\s*<\/p>/g, (match, attrs) => {
    const src = /\bsrc="([^"]+)"/.exec(attrs)?.[1] ?? '';
    const alt = (/\balt="([^"]*)"/.exec(attrs)?.[1] ?? '').trim();
    if (!src || /^[a-z]+:\/\//i.test(src)) return match;
    const absolute = 'file:///' + path.resolve(ROOT, src).replace(/\\/g, '/');
    const caption = alt ? `<figcaption>${alt}</figcaption>` : '';
    return `<figure class="plate"><img src="${absolute}" alt="${alt}" />${caption}</figure>`;
  });

  /**
   * Figures are numbered in body order and recorded as they are numbered, so the
   * contents page can carry a figure index that cannot disagree with the
   * captions — both come from this one pass.
   */
  const figures = [];
  const numbered = withFigures.replace(/<figcaption>(.*?)<\/figcaption>/gs, (match, inner) => {
    const label = inner
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/\.\s/)[0]
      .slice(0, 74);
    figures.push(label);
    return `<figcaption><b>Figure ${figures.length}.</b> ${inner}</figcaption>`;
  });

  return { html: numbered, figures };
}

function buildCoverHtml() {
  /**
   * The cover job owns its page: zero page margin, because the cover band draws
   * its own 18 mm gutter. Without this the shared `@page` margin would be added
   * to a 297 mm cover box and push the last line onto a second page.
   */
  const coverCss = `${CSS}\n  @page { margin: 0; }\n  .cover { break-after:auto; page-break-after:auto; }\n`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>${DOC.title}</title><style>${coverCss}</style></head>
<body class="cover-only">
  <section class="cover">
    <div class="cover-grid"></div>
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
    <div class="cover-foot">
      <div class="cover-meta">${DOC.source}</div>
      <div class="cover-badge">${DOC.version ?? DOC.chips[DOC.chips.length - 1]}</div>
    </div>
  </section>
</body>
</html>`;
}

function buildBodyHtml(body, toc, figures = []) {
  const tocHtml = toc
    .map((item) => `<li class="lvl${item.depth}"><a href="#${item.id}">${item.text}</a></li>`)
    .join('\n');

  /**
   * A figure index earns its place on a technical document: a reader looking for
   * the architecture drawing should not have to page through prose to find it,
   * and the list also closes the white space under a two-column contents list.
   */
  const figuresHtml = figures.length
    ? `<div class="toc-figures">
    <p class="toc-sub">Figures and plates</p>
    <ol>${figures
      .map((label, index) => `<li><span class="fig-no">${index + 1}</span>${label}</li>`)
      .join('')}</ol>
  </div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>${DOC.title}</title><style>${CSS}</style></head>
<body>
  <section class="toc">
    <p class="toc-eyebrow">${DOC.title} · ${DOC.subtitle}</p>
    <h1 class="toc-title">Contents</h1>
    <div class="toc-rule"></div>
    <ol>${tocHtml}</ol>
    ${figuresHtml}
    <div class="toc-facts">
      <div><b>Version</b>${DOC.version ?? 'Version 1.0'}</div>
      <div><b>Reader</b>${DOC.readerNote ?? 'Client technical stakeholders, onboarding engineers'}</div>
      <div><b>Rebuild</b>${DOC.rebuildNote ?? 'npm run docs:manual'}</div>
    </div>
  </section>

  ${body}
</body>
</html>`;
}

/**
 * Cover in front of body, as two prints.
 *
 * Chrome draws the header and footer templates on every page of a job, and no
 * CSS switch turns them off for the first page alone — `@page :first` changes
 * the margin box, not the template. So the cover is printed as its own one-page
 * job with no templates at all, and the two PDFs are concatenated here. The
 * cover therefore carries no running title above a title, and the body keeps
 * its page numbers starting at 1.
 */
async function mergeCoverIntoBody({ coverPath, bodyPath, outPath }) {
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  for (const source of [coverPath, bodyPath]) {
    const doc = await PDFDocument.load(fs.readFileSync(source));
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  merged.setTitle(`${DOC.title} — ${DOC.subtitle}`);
  merged.setSubject(DOC.standfirst);
  merged.setCreator('MGHub docs pipeline');
  merged.setProducer('MGHub docs pipeline');
  fs.writeFileSync(outPath, await merged.save());
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  if (!fs.existsSync(SRC)) throw new Error(`missing source: ${SRC}`);

  // the cover carries the title, so drop the duplicated leading H1
  const md = fs.readFileSync(SRC, 'utf8').replace(/^#\s+.*\r?\n/, '');
  const { body, toc } = renderMarkdown(md);
  const plates = renderPlates(body);
  const bodyHtml = buildBodyHtml(plates.html, toc, plates.figures);

  const coverPath = path.join(WORK, 'cover.html');
  const htmlPath = path.join(WORK, 'user-manual.html');
  fs.writeFileSync(coverPath, buildCoverHtml(), 'utf8');
  fs.writeFileSync(htmlPath, bodyHtml, 'utf8');

  const browser = await chromium.launch({
    ...(chromePath ? { executablePath: chromePath } : { channel: 'chrome' }),
    args: ['--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const coverPdf = path.join(WORK, 'cover.pdf');
  const bodyPdf = path.join(WORK, 'body.pdf');

  try {
    await page.goto('file:///' + coverPath.replace(/\\/g, '/'), { waitUntil: 'load' });
    await page.pdf({
      path: coverPdf,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });

    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });
    await page.pdf({
      path: bodyPdf,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate:
        `<div style="width:100%;font-size:7pt;color:#8a8f99;padding:0 16mm;font-family:Segoe UI,sans-serif;">${DOC.title} — ${DOC.subtitle}</div>`,
      footerTemplate:
        `<div style="width:100%;font-size:7pt;color:#8a8f99;padding:0 16mm;font-family:Segoe UI,sans-serif;display:flex;justify-content:space-between;"><span>${DOC.version ?? DOC.chips[DOC.chips.length - 1]}</span><span class="pageNumber"></span></div>`,
    });
  } finally {
    await browser.close();
  }

  await mergeCoverIntoBody({ coverPath: coverPdf, bodyPath: bodyPdf, outPath: OUT });

  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  const { PDFDocument } = await import('pdf-lib');
  const pages = (await PDFDocument.load(fs.readFileSync(OUT))).getPageCount();
  console.log(
    `wrote ${path.relative(ROOT, OUT)} — ${pages} pages, ${kb} KB (${toc.length} contents entries)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


