/**
 * Client procedure for Employees → Bulk import.
 * Run: node scripts/employee-bulk-import-guide.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const NAVY = rgb(0.153, 0.153, 0.247);
const RUST = rgb(0.655, 0.235, 0.141);
const INK = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.35, 0.35, 0.4);
const LINE = rgb(0.82, 0.8, 0.78);
const PAPER = rgb(1, 1, 1);
const HEAD = rgb(0.93, 0.91, 0.89);
const ZEBR = rgb(0.975, 0.97, 0.965);
const WASH = rgb(0.965, 0.953, 0.945);

const W = 595.28;
const H = 841.89;
const M = 46;
const CW = W - M * 2;
const FOOT = 46;

const doc = await PDFDocument.create();
doc.setTitle("Employee bulk import — client procedure");
doc.setAuthor("MGHub");
doc.setSubject("How to create and update employees, including restaurant, zone, partner, documents and assets");

const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

let page = doc.addPage([W, H]);
let y = H - 64;
let pageNo = 1;
const warnings = [];

function widthOf(text, size, face = font) {
  return face.widthOfTextAtSize(text, size);
}

function wrap(text, size, max, face = font) {
  const words = String(text).split(/\s+/).filter((word) => word.length > 0);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (widthOf(next, size, face) > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function paint(text, x, yPos, size, face, color, footerLine = false) {
  const w = widthOf(text, size, face);
  if (x < M - 2 || x + w > W - M + 8) {
    warnings.push(`wide: ${text.slice(0, 48)}`);
  }
  if (!footerLine && yPos < FOOT - 4) warnings.push(`low: ${text.slice(0, 48)}`);
  page.drawText(text, { x, y: yPos, size, font: face, color });
}

function footer() {
  page.drawLine({
    start: { x: M, y: 34 },
    end: { x: W - M, y: 34 },
    thickness: 0.5,
    color: LINE,
  });
  paint("MGHub  ·  Employee bulk import  ·  Client procedure", M, 20, 8, font, MUTED, true);
  const label = String(pageNo);
  paint(label, W - M - widthOf(label, 8), 20, 8, font, MUTED, true);
}

function contentTop() {
  page.drawRectangle({ x: 0, y: H - 28, width: W, height: 28, color: NAVY });
  page.drawRectangle({ x: 0, y: H - 31, width: W, height: 3, color: RUST });
  paint("Employee bulk import", M, H - 18, 9, bold, PAPER);
  const side = "Client procedure";
  paint(side, W - M - widthOf(side, 9), H - 18, 9, font, rgb(0.85, 0.82, 0.78));
  y = H - 54;
}

function newPage(fromCover = false) {
  if (!fromCover) footer();
  pageNo += 1;
  page = doc.addPage([W, H]);
  contentTop();
}

function need(h) {
  if (y - h < FOOT + 8) newPage();
}

function gap(n) {
  y -= n;
}

function h1(text) {
  need(32);
  paint(text, M, y, 15, bold, NAVY);
  y -= 8;
  page.drawRectangle({ x: M, y, width: 40, height: 2, color: RUST });
  y -= 16;
}

function h2(text) {
  need(22);
  paint(text, M, y, 11.5, bold, NAVY);
  y -= 16;
}

function para(text) {
  const lines = wrap(text, 10, CW);
  need(lines.length * 14 + 6);
  for (const line of lines) {
    paint(line, M, y, 10, font, INK);
    y -= 14;
  }
  y -= 4;
}

function bullet(text) {
  const lines = wrap(text, 10, CW - 16);
  need(lines.length * 14 + 2);
  page.drawRectangle({ x: M, y: y + 2, width: 4, height: 4, color: RUST });
  lines.forEach((line, i) => {
    paint(line, M + 14, y, 10, font, INK);
    y -= 14;
    if (i === lines.length - 1) y -= 2;
  });
}

function step(n, title, body) {
  const lines = wrap(body, 10, CW - 36);
  const block = 16 + lines.length * 14 + 8;
  need(block);
  const num = String(n).padStart(2, "0");
  paint(num, M, y, 11, bold, RUST);
  paint(title, M + 28, y, 11, bold, NAVY);
  y -= 16;
  for (const line of lines) {
    paint(line, M + 28, y, 10, font, INK);
    y -= 14;
  }
  y -= 8;
}

function note(title, body) {
  const lines = wrap(body, 9.5, CW - 22);
  const boxH = 20 + lines.length * 13 + 8;
  need(boxH + 8);
  const top = y + 12;
  page.drawRectangle({
    x: M,
    y: top - boxH,
    width: CW,
    height: boxH,
    color: WASH,
    borderColor: LINE,
    borderWidth: 0.6,
  });
  page.drawRectangle({ x: M, y: top - boxH, width: 3, height: boxH, color: RUST });
  paint(title, M + 12, y, 10, bold, NAVY);
  y -= 15;
  for (const line of lines) {
    paint(line, M + 12, y, 9.5, font, INK);
    y -= 13;
  }
  y = top - boxH - 10;
}

function cellLines(value, inner, face, size) {
  return wrap(value == null || value === "" ? " " : String(value), size, inner, face);
}

function table(headers, rows, widths) {
  const size = 8.5;
  const lead = 11;
  const padX = 5;
  const padY = 5;
  const sum = widths.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - CW) > 1) warnings.push(`widths ${sum} != ${CW}`);

  function heightOf(cells, face, sz) {
    let lines = 1;
    cells.forEach((cell, i) => {
      lines = Math.max(lines, cellLines(cell, widths[i] - padX * 2, face, sz).length);
    });
    return lines * lead + padY * 2;
  }

  function drawRow(cells, face, sz, fill, color, yTop) {
    const h = heightOf(cells, face, sz);
    page.drawRectangle({
      x: M,
      y: yTop - h,
      width: CW,
      height: h,
      color: fill,
      borderColor: LINE,
      borderWidth: 0.4,
    });
    let x = M;
    cells.forEach((cell, i) => {
      if (i > 0) {
        page.drawLine({
          start: { x, y: yTop },
          end: { x, y: yTop - h },
          thickness: 0.4,
          color: LINE,
        });
      }
      const lines = cellLines(cell, widths[i] - padX * 2, face, sz);
      lines.forEach((line, li) => {
        paint(line, x + padX, yTop - padY - sz - li * lead, sz, face, color);
      });
      x += widths[i];
    });
    return h;
  }

  function drawHead() {
    const h = heightOf(headers, bold, 8);
    need(h + 8);
    const used = drawRow(headers, bold, 8, NAVY, PAPER, y);
    y -= used;
  }

  drawHead();
  rows.forEach((row, index) => {
    const h = heightOf(row, font, size);
    if (y - h < FOOT + 8) {
      newPage();
      drawHead();
    }
    const used = drawRow(row, font, size, index % 2 === 0 ? PAPER : ZEBR, INK, y);
    y -= used;
  });
  y -= 12;
}

/* Cover */
page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: NAVY });
page.drawRectangle({ x: 0, y: 0, width: 8, height: H, color: RUST });
paint("MGHUB", 52, H - 78, 11, bold, rgb(0.82, 0.78, 0.74));
paint("Employee bulk import", 52, H - 132, 28, bold, PAPER);
paint("Client procedure", 52, H - 162, 16, font, rgb(0.86, 0.82, 0.78));
page.drawRectangle({ x: 52, y: H - 184, width: 48, height: 3, color: RUST });

const cover = [
  "How to create employees and update existing ones from one Excel file.",
  "People are matched on MG ID only.",
  "This guide shows the update for each area:",
];
cover.forEach((line, i) => {
  paint(line, 52, H - 230 - i * 18, 11, font, PAPER);
});

const areas = [
  ["01", "Restaurant"],
  ["02", "Zone"],
  ["03", "Partner"],
  ["04", "Documents"],
  ["05", "Assets"],
  ["06", "Identity, pay, bank, status and the other fields"],
];
areas.forEach((item, i) => {
  const row = H - 320 - i * 28;
  paint(item[0], 52, row, 12, bold, RUST);
  paint(item[1], 84, row, 12, font, PAPER);
});

paint("Employees  >  Bulk import", 52, 96, 12, bold, PAPER);
paint("English panel labels  ·  23 October 2026", 52, 76, 10, font, rgb(0.75, 0.72, 0.68));

newPage(true);
h1("How a cell is applied");
para("The sheet writes only the columns it contains. Three rules apply on every column, including restaurant, zone, partner, documents and assets.");
table(
  ["Cell", "On an existing employee", "On a new employee"],
  [
    ["Filled in", "Replaces the stored value", "Stored on the new employee"],
    ["Left blank", "Keeps the stored value", "Uses the field default"],
    ["Contains only -", "Clears that field", "Leaves the field empty"],
    ["Column removed", "That field is not touched", "That field is not written"],
  ],
  [120, 187, 196],
);
note(
  "Match on MG ID",
  "An existing person is found only by MG ID. The headers MG ID, MGID, Employee ID, EmployeeID and employee_id are the same field. Spaces at the ends and letter case are ignored. Phone, civil ID, passport and driver code are not used to find a person. Two live people with the same MG ID block that row.",
);
h2("Before the first file");
bullet("Open Employees and click Bulk import. Stay on New import.");
bullet("You need permission to manage drivers. Accepted files are .xlsx, .xls and .csv.");
bullet("Click Download sample template. The file is dpd-driver-import-template.xlsx.");
bullet("Use the Guide sheet for allowed values. Use Restaurants, Zones, Partners and Companies for codes to copy.");
bullet("Columns at 46/46 includes every writable field. Full name, MG ID, Zone ID and Restaurant IDs stay in the file even if other columns are unticked.");
bullet("Delete the two sample people before you import. Importing them creates those example employees.");

newPage();
h1("The ten steps");
step(1, "Open Bulk import", "On the Employees list, click Bulk import. New import is the upload. Previous imports is the history.");
step(2, "Tick the columns this file should change", "Click Columns. Select all for a full file. For an update, keep MG ID plus only the columns you intend to change, so every other field stays as it is.");
step(3, "Download the sample", "Click Download sample template. Open Drivers, Guide, Restaurants, Zones, Partners and Companies. Download all IDs refreshes the lookup lists.");
step(4, "Fill one row per person", "Keep the header row. Copy codes from the lookup sheets. Do not type a vehicle plate that is not already in the fleet.");
step(5, "Upload the file", "Drop the file on the dialog or click the drop area. The dialog moves to column mapping.");
step(6, "Check the mapping", "Each header must point at one field. Map Full name and MG ID. Map Zone or Restaurants for a new person. Preview stays off until the required fields are mapped. Two headers on the same field block the import.");
step(7, "Read the preview", "The summary is ready, existing MG IDs, and invalid. Status names the problem on a refused row. Only ready rows are written. Fix the sheet and upload again for the rest.");
step(8, "Set the two switches", "Update existing by MG ID stays on to update that person. Turn it off to skip people who already exist. Approve immediately mints a passcode only when the Active cell is blank. yes or no in Active overrides the switch.");
step(9, "Import", "Click Import N rows. The log shows progress. The window can be hidden. Pause, Resume and Cancel are on that screen.");
step(10, "Keep the result", "Download errors for rows that failed while writing. Download credentials if new logins were created, and store the passcodes. Open the employee and confirm the columns this file was meant to change.");

newPage();
h1("Update a restaurant");
para("Column header: Restaurant IDs. Copy the value from the Restaurants sheet, column RST code (paste this). A unique restaurant name or the restaurant ID also matches. Separate several restaurants with a comma.");
table(
  ["MG ID", "Restaurant IDs", "Result"],
  [
    ["10421", "RST-0142", "That restaurant replaces the rider's current list"],
    ["10422", "RST-0142, RST-0201", "Both restaurants replace the current list"],
    ["10423", "-", "Every restaurant is removed"],
    ["10424", "(blank)", "Restaurants stay as they are"],
  ],
  [80, 170, 253],
);
note(
  "Replace, not add",
  "A filled Restaurant IDs cell is the full new list. It does not add one restaurant beside the ones already assigned. To keep an existing restaurant, include its code in the cell. A new employee still needs a restaurant or a zone. If both are blank, the row is refused.",
);
para("Rows marked Importable = No on the Restaurants sheet cannot be used. A name that matches two restaurants is refused. Use the RST code in that case.");

h1("Update a zone");
para("Column header: Zone ID. Copy Code, Name, or ID (paste this) from the Zones sheet. Code is checked before name. One zone per person.");
table(
  ["MG ID", "Zone ID", "Result"],
  [
    ["10421", "JAH-01", "Zone becomes that code"],
    ["10422", "Jahra", "Zone becomes that name, when the name is unique"],
    ["10423", "-", "Zone is cleared"],
    ["10424", "(blank)", "Zone stays as it is"],
  ],
  [80, 140, 283],
);
para("A name or code that matches more than one zone is refused. Paste ID (paste this) when the name is shared.");

newPage();
h1("Update a partner");
para("Column header: Partner. Copy Name (paste this) from the Partners sheet, or paste the ID. Letter case does not matter.");
table(
  ["MG ID", "Partner", "Result"],
  [
    ["10421", "Talabat", "Partner becomes Talabat"],
    ["10422", "-", "Partner is cleared"],
    ["10423", "(blank)", "Partner stays as it is"],
  ],
  [80, 140, 283],
);
para("A partner name that matches more than one record is refused. Paste the ID from the Partners sheet. The partner is the commercial partner on the employee. It is separate from Company Name and from the restaurant list.");

h1("Update documents");
para("The sheet sets expiry dates only. It does not upload a scan or a photo. A date already on file is kept when the cell is blank. A dash stops expiry tracking and leaves the uploaded file in place.");
table(
  ["Column", "Document"],
  [
    ["License Expiry", "Driving licence"],
    ["Civil ID Expiry", "Civil ID"],
    ["Work Permit Expiry", "Work permit"],
    ["Passport Expiry", "Passport"],
    ["Health Card Expiry", "Health card"],
    ["Operations Card Expiry", "Operations card"],
  ],
  [200, 303],
);
table(
  ["MG ID", "License Expiry", "Passport Expiry", "Result"],
  [
    ["10421", "2027-06-30", "2028-01-15", "Both dates are saved"],
    ["10422", "2027-06-30", "(blank)", "Licence date changes. Passport date stays"],
    ["10423", "-", "(blank)", "Licence tracking stops. The file stays. Passport stays"],
  ],
  [70, 110, 120, 203],
);
para("Dates are YYYY-MM-DD or DD-MM-YYYY. Residency Expiry is a separate date on the employee. It is not one of the six document files.");

newPage();
h1("Update assets");
para("Column header: Assets. Type the asset catalog name or its code. Separate several with a comma. The cell is the full new list: it replaces the assets currently assigned.");
table(
  ["MG ID", "Assets", "Result"],
  [
    ["10421", "Helmet, Vest", "Those assets replace the current assignment"],
    ["10422", "Fuel Chip", "Only Fuel Chip remains assigned"],
    ["10423", "-", "Every assigned asset is returned"],
    ["10424", "(blank)", "Assets stay as they are"],
  ],
  [80, 140, 283],
);
note(
  "One unknown name fails the row",
  "Every name or code in the cell must exist on the active asset catalog. One unknown item refuses the whole row, and no asset on that row is changed. An inactive catalog item cannot be assigned.",
);

h1("Update the other fields");
para("Same blank and dash rules. Keep MG ID in the file and delete every column you do not intend to change.");
table(
  ["Area", "Column", "What to type"],
  [
    ["Name", "Full Name", "The employee name"],
    ["Phone", "Phone", "Kuwait mobile, with or without +965. Unique when filled"],
    ["Civil ID", "Civil ID", "12 digits. Unique when filled. Blank is allowed"],
    ["Passport", "Passport", "Passport number"],
    ["Nationality", "Nationality", "Catalog label, for example Indian"],
    ["Country", "Country", "Country name or ISO code. Separate from Nationality"],
    ["Platform", "Client ID, Platform", "Shared contract text. Not a match key"],
    ["Company", "Company Name", "Name or Client ID from the Companies sheet"],
    ["Category", "Rider Category", "in_house or outsourced. Blank means in_house"],
    ["Project", "Project", "A project key such as keeta or americana"],
    ["Section", "Section", "Section names, comma-separated"],
    ["Status", "Employee Status", "A status from the catalog, for example running"],
    ["Active", "Active", "yes or no. Blank follows Approve immediately"],
    ["OFFs", "Number of OFFs", "Whole number for the current Kuwait month"],
    ["Work start", "Work Start", "Date. Stored as the work start date"],
    ["Job", "Job Position", "rider or light_driver"],
    ["Hiring", "Hiring Type", "overseas, old_local, new_local, outsourcing_partner"],
    ["Sponsorship", "Sponsorship", "A sponsorship from Settings"],
    ["Salary", "Fixed Salary", "Amount, zero or greater, up to 3 decimals"],
    ["Permit pay", "Work Permit Salary", "Amount, zero or greater, up to 3 decimals"],
    ["Increment", "Last Increment", "Date of the last increment"],
    ["Bank", "Bank", "Bank code or name, or cash"],
    ["Account", "Account Number", "6 to 20 digits. Cleared when the bank is cash"],
    ["IBAN", "IBAN", "Kuwait IBAN. Cleared when the bank is cash"],
    ["Currency", "Currency", "KWD or another payment code. Blank with a bank becomes KWD"],
    ["Vehicle", "Vehicle", "Plate or bike id that already exists"],
    ["Type", "Vehicle Type", "bike or car. A missing column does not change the type"],
  ],
  [90, 150, 263],
);

newPage();
h1("Bank, company and OFFs");
bullet("Bank set to cash clears the account number and the IBAN. A dash in Bank clears the whole bank record.");
bullet("An in-house rider belongs to the system company. An outsourced rider belongs to a partner company, or stays Unassigned when Company Name is blank.");
bullet("Number of OFFs is written only when the person is approved on this import or is already linked. A blank cell keeps the default of 2 and writes nothing.");
bullet("Screenshots and Login Exempt are yes or no. A dash on Screenshots turns the flag off.");

h1("What this file cannot change");
bullet("Driver code. The system assigns it. Import never rewrites it.");
bullet("App passcode. Approve immediately mints one. Download credentials saves it. The sheet cannot type a passcode.");
bullet("On duty, today's deliveries, workflow, linked, blocked and freeze.");
bullet("Profile photo, and the scan or photo on a document. Only the expiry date can be set.");

h1("When a row is refused");
para("The preview Status column uses these words. A refused row is not written and is not part of undo.");
table(
  ["Status", "What to fix"],
  [
    ["Missing fields", "Full name or MG ID is empty"],
    ["Needs a zone or a restaurant", "A new person has neither"],
    ["Unknown restaurant", "RST code or name is not on the Restaurants sheet"],
    ["Unknown zone", "Code, name or ID is not on the Zones sheet"],
    ["Unknown partner", "Name or ID is not on the Partners sheet"],
    ["Unknown asset", "A name or code is not on the active asset catalog"],
    ["Unknown vehicle", "That plate or bike id is not in the fleet"],
    ["Duplicate phone or civil ID", "The number already belongs to someone else"],
    ["MG ID matches more than one person", "Correct the duplicate MG ID before import"],
    ["Two columns point at the same field", "Change the mapping. Import stays off"],
    ["Date must be YYYY-MM-DD", "Use YYYY-MM-DD or DD-MM-YYYY"],
  ],
  [230, 273],
);

h2("Undo");
para("On the preview step, Undo last import reverses the whole last applied batch, including a login created by approve and the restaurant, zone, partner, document dates and assets that batch wrote. Redo puts that batch back. A new import clears the redo stack. Do this before you run the next file.");

footer();

const bytes = await doc.save();
const out = "docs/EMPLOYEE_BULK_IMPORT.pdf";
writeFileSync(out, bytes);
const check = await PDFDocument.load(readFileSync(out));
console.log(`${out} pages=${check.getPageCount()} bytes=${bytes.length} warnings=${warnings.length}`);
for (const warning of warnings) console.log(warning);
if (warnings.length) process.exitCode = 1;
