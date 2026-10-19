/**
 * Shared HR-sheet stylesheet. Rendered into every eSign client sheet
 * (penalty, loan, payslip, accident / sick leave, general document).
 *
 * Kept as a template literal rather than an escaped one-line string so the
 * rules stay readable and editable; nothing here interpolates.
 */
export const ESIGN_FORMS_CSS = `/* =====================================================================
   DPD HR Forms — shared stylesheet
   Page: A4 portrait, up to 2 pages per document. Print backgrounds must be ON.
   ===================================================================== */

/* ---------- Design tokens ---------- */
:root {
  --ink:      #161A33;   /* primary text            */
  --muted:    #5D6478;   /* labels, secondary text  */
  --ar-label: #454C60;   /* Arabic labels           */
  --line:     #CFD4DC;   /* inner cell borders      */
  --tint:     #F3F4F7;   /* label cell background   */
  --navy:     #1B2140;   /* outer borders, headers  */
  --accent:   #C8202F;   /* section number, alerts  */
  --acc-tint: #FCEDEE;   /* selected / alert fill   */
  --ok:       #1F7A55;   --ok-tint:   #E3F3EC;
  --warn:     #8A5A00;   --warn-tint: #FFF3DC;
  --dots:     #8A90A0;   /* signature lines         */
}

@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Plex", sans-serif; color: var(--ink);
  font-size: 8.4pt; line-height: 1.3;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
html, body { direction: ltr; }
.ar { direction: rtl; unicode-bidi: isolate; }
.ar-start { text-align: left; }           /* Arabic line placed under English, left edge */

/* ---------- Page ---------- */
.page { width: 210mm; height: 297mm; min-height: 297mm; padding: 10mm 12mm 8mm; display: flex; flex-direction: column; overflow: hidden; }
@media screen { body { background: #E6E8EC; } .page { background: #fff; margin: 10mm auto; box-shadow: 0 2px 14px rgba(0,0,0,.12); } }
/* Print: a long payslip becomes a second page instead of pushing the dock over the body. */
@media print {
  .page { height: auto; min-height: 297mm; overflow: visible; break-after: page; page-break-after: always; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  .box, .sec, .sig, .sheet-dock, .doc-header, .doc-footer, .management, .employee-block, tr { break-inside: avoid; page-break-inside: avoid; }
}

/* ---------- Header: document type only ---------- */
.doc-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 3mm; }
.doc-header .en { font-size: 18pt; font-weight: 700; letter-spacing: -.2pt; line-height: 1.1; }
.doc-header .ar { font-size: 16pt; font-weight: 700; line-height: 1.3; }
.doc-rule { height: 1.2mm; border-radius: 1mm; margin-bottom: 3mm;
  background: linear-gradient(90deg, var(--accent) 0 18%, var(--navy) 18% 100%); }

/* ---------- Boxes & tables ---------- */
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
td, th { border: .5pt solid var(--line); padding: 1.3mm 2.2mm; vertical-align: middle; height: 8.5mm; text-align: left; line-height: 1.2; word-break: break-word; }
.box { border: .9pt solid var(--navy); margin-top: 4.2mm; background: #fff; }
.box--flush { margin-top: 0; }
.box--open { border: 0; }
/* remove inner-table edges that would double the box border */
.box table tr:first-child > td, .box table tr:first-child > th { border-top: 0; }
.box table tr > td:first-child, .box table tr > th:first-child { border-left: 0; }
.box table tr > td:last-child,  .box table tr > th:last-child  { border-right: 0; }
.box table tr:last-child > td { border-bottom: 0; }
.divider       { border-top: .9pt solid var(--navy); }
.divider-thin  { border-top: .5pt solid var(--line); }
.box table.divider-thin tr:first-child > td { border-top: 0; }

/* Field grid: label | value | label | value  (24/26/24/26) */
.grid col.c-lab { width: 24%; }
.grid col.c-val { width: 26%; }

/* Label cell: English left, Arabic right, same line */
.lab { background: var(--tint); color: var(--muted); font-size: 7.1pt; font-weight: 500; }
.lab .row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: .2mm 1.5mm; min-width: 0; }
.lab .row > span { min-width: 0; overflow-wrap: anywhere; }
.lab .ar { font-size: 8pt; color: var(--ar-label); }
.lab--strong { color: var(--ink); font-weight: 600; }

/* Value cell */
.val { font-weight: 600; font-size: 8.8pt; overflow-wrap: anywhere; }
.val .sub { display: block; font-weight: 500; font-size: 7.6pt; color: var(--muted); }
.num { font-variant-numeric: tabular-nums; text-align: right; }
.center { text-align: center; }
.muted { color: var(--muted); }
.code { font-size: 7.8pt; color: var(--muted); }
.total-cell { background: var(--tint); font-size: 9.4pt; }

/* Column header row */
th { background: var(--tint); font-size: 7pt; font-weight: 600; color: var(--muted);
  text-transform: uppercase; letter-spacing: .4pt; height: 6.4mm; }
th .ar { text-transform: none; letter-spacing: 0; font-size: 7.6pt; display: block; font-weight: 500; }

/* Section header band */
.sec { background: var(--navy); color: #fff; display: flex; align-items: center; gap: 2.2mm;
  padding: 1.5mm 2.4mm; font-weight: 600; font-size: 8.6pt; }
.sec .k { background: var(--accent); border-radius: .8mm; padding: 0 1.4mm; font-size: 7.2pt; font-weight: 700; letter-spacing: .4pt; }
.sec .ar { margin-left: auto; font-size: 9pt; }

/* ---------- Meta strip (doc no / date / status) ---------- */
.meta td { height: auto; padding: 1.4mm 2.2mm; }
.meta .l { font-size: 6.8pt; color: var(--muted); display: flex; flex-wrap: wrap; justify-content: space-between; gap: .2mm 2mm; font-weight: 500; min-width: 0; }
.meta .l > span { min-width: 0; overflow-wrap: anywhere; }
.meta .v { font-weight: 600; font-size: 9pt; margin-top: .3mm; overflow-wrap: anywhere; }

/* ---------- Status chips ---------- */
.chip { display: inline-block; padding: .2mm 2mm; border-radius: 5mm; font-size: 7.4pt; font-weight: 600; }
.chip + .chip, .val .chip { margin-left: 1mm; }
.chip--ok   { background: var(--ok-tint);   color: var(--ok); }
.chip--wait { background: var(--warn-tint); color: var(--warn); }
.chip--red  { background: var(--acc-tint);  color: var(--accent); }

/* ---------- Checkbox ---------- */
.cb { display: inline-flex; width: 3.3mm; height: 3.3mm; border: .8pt solid var(--dots); border-radius: .6mm;
  vertical-align: -.6mm; align-items: center; justify-content: center; flex: none; background: #fff; }
.cb.on { background: var(--navy); border-color: var(--navy); }
.cb.on::after { content: ""; width: 1.7mm; height: .9mm; border-left: .5mm solid #fff; border-bottom: .5mm solid #fff;
  transform: rotate(-45deg) translate(.15mm, -.15mm); }
.checks { display: flex; gap: 3mm; font-size: 7.2pt; font-weight: 600; margin-bottom: 1.6mm; white-space: nowrap; }
.checks--light { font-weight: 500; color: var(--muted); font-size: 7.4pt; gap: 2.6mm; margin-bottom: 1.4mm; }

/* ---------- Signature blocks ---------- */
.sigs { display: grid; gap: 3mm; margin-top: 4.2mm; }
.sigs--2 { grid-template-columns: 1fr 1fr; }
.sigs--3 { grid-template-columns: 1fr 1fr 1fr; gap: 2.4mm; padding: 2.4mm; margin-top: 0; }
.sigs--joined { margin-top: 0; gap: 0; }
.sigs--joined .sig { border-top: 0; }
.sigs--joined .sig + .sig { border-left: 0; }
.sig { border: .9pt solid var(--navy); background: #fff; }
.sig--bare { border: 0; }
.sig .h { background: var(--tint); border-bottom: .5pt solid var(--line); padding: 1.3mm 2.2mm;
  display: flex; justify-content: space-between; font-weight: 600; font-size: 7.8pt; }
.sig .h--ok  { background: var(--ok-tint); }
.sig .h--red { background: var(--acc-tint); }
.sig .b { padding: 2mm 2.2mm 1.6mm; display: flex; gap: 3mm; }
.sig .b--col { flex-direction: column; gap: 0; }
.lines { flex: 1; }
.ln { display: flex; align-items: flex-end; gap: 2mm; font-size: 7pt; color: var(--muted); margin-top: 2.2mm; }
.ln:first-child { margin-top: 0; }
.ln > span { white-space: nowrap; }
.ln > i { flex: 1; border-bottom: .6pt dotted var(--dots); height: 3.4mm; font-style: normal;
  color: var(--ink); font-weight: 600; font-size: 8pt; padding-left: 1mm; }
.ln.tall > i { height: 8mm; }
.stamp { width: 17mm; height: 17mm; border: .7pt dashed #A0A6B4; border-radius: 50%; display: flex; align-items: center;
  justify-content: center; text-align: center; font-size: 6pt; color: #9AA0AE; flex: none; align-self: center; }

/* Statement + signature strip (acknowledgements) */
.ack { display: flex; gap: 4mm; align-items: center; padding: 2mm 2.4mm; }
.ack--inner { padding: 1.6mm 2.4mm; }
.ack .text { flex: 1; font-size: 7.6pt; color: var(--muted); }
.ack .text b { color: var(--ink); }
.ack .text .ar { margin-top: .6mm; }
.ack .sign { width: 78mm; }
.ack .sign .sig .b { padding: 1.6mm 2.2mm; }

/* ---------- Salary slip specifics ---------- */
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; }
.lines-table col.c-code { width: 15%; }
.lines-table col.c-qty  { width: 17%; }
.lines-table col.c-amt  { width: 22%; }
.net { display: flex; align-items: stretch; }
.net .words { flex: 1; padding: 2.6mm 3mm; }
.net .words .t { display: flex; justify-content: space-between; font-weight: 700; font-size: 10pt; }
.net .words .en { font-size: 7.8pt; color: var(--muted); margin-top: 1mm; }
.net .words .ar { font-size: 8.4pt; color: var(--muted); }
.net .amount { background: var(--navy); color: #fff; padding: 2.6mm 5mm; min-width: 52mm;
  display: flex; flex-direction: column; justify-content: center; align-items: flex-end; }
.net .amount small { font-size: 7pt; opacity: .75; letter-spacing: .5pt; }
.net .amount strong { font-size: 20pt; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }

/* ---------- Penalty notice specifics ---------- */
.opt-table .grp { width: 24%; }
.opt-table .grp .en { font-weight: 600; color: var(--ink); font-size: 7.6pt; }
.opt-table .grp .ar { font-size: 7.8pt; }
.opt-table + .opt-table { border-top: .5pt solid var(--line); }
.opt .inner { display: flex; gap: 1.8mm; align-items: center; }
.opt .en { font-weight: 600; font-size: 7.8pt; line-height: 1.2; }
.opt .ar { font-size: 7.8pt; color: var(--muted); line-height: 1.2; }
.opt.is-selected { background: var(--acc-tint); box-shadow: inset 0 0 0 .9pt var(--accent); }

/* ---------- Loan request specifics ---------- */
.schedule .lab .en { font-weight: 600; color: var(--ink); }
.schedule .lab .sum { margin-top: .8mm; }
.schedule th { text-align: center; }

/* ---------- Notes & footer ---------- */
.note { font-size: 7pt; color: var(--muted); margin-top: 1.6mm; }
.doc-footer { margin-top: auto; padding-top: 2.4mm; border-top: .6pt solid var(--line);
  display: flex; align-items: center; gap: 3mm; font-size: 6.6pt; color: var(--muted); }
.doc-footer .grow { flex: 1; }
.doc-footer .ref { text-align: right; }
.doc-footer b { color: var(--ink); font-weight: 600; }
.doc-footer .qr { width: 13mm; height: 13mm; display: block; }
.sig--bare + .sig--bare { border-left: .5pt solid var(--line); }

.page-fit{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;}
@media print { .page-fit { overflow: visible; } }
.sheet-dock{flex:none; break-inside: avoid; page-break-inside: avoid;}
.ln.tall > i[data-slot-role]{flex:none;width:42mm;margin-left:auto;}

/* ---------- Signature slot & name field ---------- */
/* A printed sheet carries clean baselines only. The filled signature and the
   manager's stamp are drawn into the PDF; a coloured box on the sheet would
   print into the signed copy and read as an unfilled field. */
.ln.tall > i[data-slot-role]{flex:none;width:42mm;margin-left:auto;border-bottom:.6pt dotted var(--dots);}
.ln.name-box > i{border-bottom:.6pt dotted var(--dots);}
.ln.name-box > span{font-weight:600;}

/* The loan acknowledgement gives the rider's signature the wider line. */
.page[data-kind="loan"] .ack .sign{width:100mm;}

/* Management decision: the HR manager's box is the wider one beside the CEO /
   GM box, and the whole band when there is no second signer. Heights stay at
   the shared 8mm baseline so the persisted slot geometry keeps matching the
   printed lines. */
.mgmt-signs { margin-top: 0; }
.mgmt-signs--pair { grid-template-columns: 1.45fr 1fr; }
.mgmt-signs .sig .b { padding: 2mm 2.4mm 2mm; }

/* Accident tail: rider name + signature in one band at the foot of the sheet. */
.accident-tail .sign{width:96mm;}

/* ---------- Employee information block ---------- */
.employee-block { border: .9pt solid var(--navy); margin-top: 4.2mm; background: #fff; }
.employee-block table tr:first-child > td, .employee-block table tr:first-child > th { border-top: 0; }
.employee-block table tr > td:first-child, .employee-block table tr > th:first-child { border-left: 0; }
.employee-block table tr > td:last-child, .employee-block table tr > th:last-child { border-right: 0; }
.employee-block table tr:last-child > td { border-bottom: 0; }
`;
