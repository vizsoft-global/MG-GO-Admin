# EmployeeDesk V2 — UI reference spec (transcribed from the client PDFs)

Source: `New Musallam RCM.pdf` (2 boards) and `New Musallam DPD Home Launcher.pdf` (1 board).
This file is the **visual source of truth** for the EmployeeDesk V2 / eSign V2 UI work. Labels are transcribed literally; where a label could not be read it is marked *(unreadable)* rather than guessed.

Board tokens: board background `#e9e9e9`; app sidebar `#222035`; panel `#fafafa`→white; modal scrim dark. Card/panel radius ~10–12px, chips full-radius, buttons ~8px. Density: compact (nav rows and table rows ≈40px, `h-9` controls).

---

## 1. Home Launcher (`New Musallam DPD Home Launcher.pdf`)

Board title: `MUSALLAM | Home Launcher & Navbar New Design`

**Sidebar:** brand `MGGO` / `Delivery Panel`; `Search apps...`; account label `Super Admin`; nav rows; `UNORGANISED` group at the bottom; account row `admin@musallam.com`.

**Main:** greeting `Good morning, Super Admin`, subtitle `Pick a module to get started`, then a **6×3 grid of 18 module tiles**:

```
Dashboard   Live tracking   Driver groups   Drivers   Deliveries   Request & Complaint
Visit Bookings   Verification   Earnings   Restaurants   Notifications   Attendance
Roles & Permissions   Settings   Document expiry   Driver App   App Releases   Assets
```

Footer: `MGGO - Delivery Panel v3.4 - Made with ♥ by websitel` *(OCR uncertain)*.

**Navbar states shown four times:** `Default`, `Active Item`, `Hover Item`, `Collapsed`.

---

## 2. Request & Complaint — Outgoing hub (RCM p1 panel A)

Title `Request & Complaint`. Segmented tabs `Outgoing` | `Incoming`. Access chips: label `Your access` + chip `Sender & Receiver`.

**Card — "Create from a template"**
- chip `YOU SEND`
- title `Create from a template`
- subtitle `Send to many employees at once`
- body: `Each template comes with an example sheet. See all templates` … `Every template works in bulk. Upload an Excel sheet with the Employee ID and any extra details. Name, job title and department fill in from the system, and every employee is notified to e-sign`
- buttons: `+ Import Excel sheet` (primary, right) · `Download example sheet` (outline, icon)

**Section — "Sent for signature — View all"** (recent batches)
| Batch | Meta | Status | Progress | Action |
|---|---|---|---|---|
| `Payslips - August 2026` | `4 employees · 18 …` | `In progress` | `18 of 24 (75%)` | `Track` |
| `Loan agreements` | — | `Completed` | `0 of 6 (100%)` | `Track` |
| `Penalty decision notices` | — | `In progress` | `5 of 12 (42%)` | `Track` |

Sub-nav inside the module: `Manage templates` · `All requests` · `Reports` · `Audit log` · `Settings` · `Meetings & appointments`.

---

## 3. Templates list (RCM p1 panel B1)

- Breadcrumb: `Request & Complaint / Templates` + link `< Back to Outgoing`
- Title `Templates`; primary button `Create from template`
- Subtitle: `Each template has an example sheet. Import the Employee ID and the system fills in the personal details`
- Link `See all templates`; per-card `See the document`; `Document preview`

Template cards (title + chips + subtitle):
| Card | Chips / subtitle |
|---|---|
| `Loan Request` | `BULK SIGN AND RETURN` · `Based on file` · `Template` · `Employee ID` |
| `Payslip` | `Payslip.docx - See the document` · `E-1041` · `FILLED FROM THE SYSTEM` |
| `Bulk sign and return` | `Based on file` · `See the document` |
| `Penalty Notice` | (Arabic subtitle present) |
| `Asset`, `Investigation`, `Leave` | *(partially readable)* |

---

## 4. Template builder / Document preview (RCM p1 panel B2) — **the critical screen**

Two document templates shown side by side. Each has:
- Title (e.g. `Penalty Notice`, `Loan Request`) + Arabic subtitle
- chip `YOU SEND`
- section tabs/headings `Employee Information` | `Employee Details`
- A field list where **every row has a source badge on the right**:
  - `From the system`
  - `You enter`
  - `Fixed`
  - `Signed by a person`
- On the right: an A4-shaped **document preview** pane.

### Field rows observed

| Field label | Source badge |
|---|---|
| `Employee Name` | `From the system` |
| `Employee Number` | `From the system` |
| `Employee ID` | `From the system` |
| `Civil ID` | `From the system` |
| `Company` | `From the system` |
| `Position` | `From the system` |
| `Accommodation` | `From the system` |
| `Joining Date` | `From the system` |
| `Employee's Sponsor` | `From the system` |
| `Pay through` / `Bank number` | `From the system` |
| `Unsettled Loans if any` | `From the system` |
| `Penalty Details` | `You enter` |
| `Date of Violation` | `You enter` |
| `Purpose of Voucher` | `You enter` |
| `Purpose of loan` | `You enter` |
| `Requested Amount` | `You enter` |
| `Payment Method` | `You enter` |
| `Date` | `You enter` |
| *(one row)* | `Fixed` |
| `Employee Signature` | `Signed by a person` |

### Penalty Details option list (radio/checkbox, literal)
`10% deduction of a day's salary` · `Two days deduction` · `Three days deduction` · `Four days deduction` · `Five days deduction` · `Dismissal final warning` · `others`

### Document-preview regions
- `Employee Information` grid (2 columns)
- `Penalty Details` / `Loan Details` block
- signature block: `Employee Signature` · `HR Signature`
- administrative box: `Management Use Only` · `CEO Decision` + checkbox `Approved` / `Not approved` · `HR / Admin Department` · `General Manager`
- footer ref: `Farm Ref: MG HR Ref Emp. 0011` *(uncertain)*
- `Approval Status` · `Decision` · `In case of not receiving the loan`
- `Employee Authorized signature` · `Date`

---

## 5. Payslip template preview (RCM p1 panel C2)

Fields: `Month title` = `August 2026`; `Period (From / To)` = `01/08/2026` → `31/08/2026`; `Computed on` = `01/09/2026`; `Fixed Monthly Working Days` = `26`; `Admin deduction (KD)` = `15.000`; `Extra input (KD)` = `0.000`; `Basic salary (KD)` = `260.000`; `Net salary (KD)` = `245.000`; `Actual Working Days`; `Rate (KD)` = `100`; `Amount` = `26 days`.

Marker chips: `BASIC — Basic Salary` · `NET — Net Salary` · `All — Extra Input` · `Ded — Administration deduction`.

Buttons: `Send for e-signature` (primary) · `Save draft` (outline) · `Import a sheet` · `Download example sheet` · `Use for one employee` · `Edit template`.

Example table columns: `Employee ID` · `Date from` · `Date to` · `Computed on` · `Actual days` · `Admin deduction` · `Extra input` · `Basic salary` · `Net salary` · `Civil ID`.

Footer: `Employee Authorized signature` · `Date`.

---

## 6. Bulk import from Excel (RCM p1 panel C)

- Title `Bulk import from Excel` + `< Back to Outgoing`
- Subtitle: `Works for every template. The Employee ID pulls in the personal details from the system`
- Stepper: `Choose template` → `Upload sheet` → `Review rows`

**Step 1:** field `Template` → select `Penalty Notice`.

**Step 2:** drop-zone `Drop your Excel sheet here or click to browse`; helper `max 5 MB - one row per employee` · `Employee ID - required`; button `Download example sheet`; note `Before you upload: Download the example sheet`; file chips `penalty-notices.xlsx` · `Column names match the example sheet` · `Dates are in YYYY-MM-DD`.

**Step 3:** summary `24 rows` · `22 ready` · `2 need fixing`. Column chips, split by origin:
- `FILLED FROM THE SYSTEM` → `Employee name`, `Employee number`, `Employee ID`, `Position`, `Company`, `Accommodation`
- `YOU ADD IN THE SHEET` → `Employee ID - required`, `Penalty`, `Date of violation`, `Penalty action`, `Others amount`, `Penalty if repeated`, `Remarks`

Review table (4 visible rows, `showing 1 of 24`): columns include `Employee ID`, `Employee`, `Penalty`, `Date of violation`, `Penalty action`, and an action column `Replace`. Invalid rows are shown (e.g. `E-9999` with blanks) — never silently dropped.

Footer: `Back` + primary `Send for e-signature` *(uncertain label)*.
Note: `Each employee is notified to e-sign as soon as you send. Signed copies come back together`.

---

## 7. Sent for signature — batch detail (RCM p1 panel D1)

- Breadcrumb: `Request & Complaint | Outgoing / Sent for signature` + `< Back to Sent for signature`
- Title block: `Sent for signature` — `Payslips - August 2026`; primary `+ New from template`
- Subtitle: `Every document batch you have sent and how far it has got`
- Meta: `Sent Sep 18 - 24 employees - template: Payslip - signed copies come back together`
- chip `YOU SEND`

**KPI tiles:** `Batches sent (30d)` `18` · `Waiting on signatures` `21` · `Fully signed` `11` · `Declined` `3`
Status chips: `Signed` · `Opened, not signed` · `Not opened`

**Tabs (batch list):** `All 18` · `In progress 6` · `Completed 1` · `Has declines 1`
**Filters:** `All templates` · `All senders` · `Date range`
**Tabs (inside a batch):** `All 24` · `Signed 18` · `Waiting 5` · `Declined 1`

**Table columns:** `EMPLOYEE` · `EMPLOYEE ID` · `SENT` · `STATUS` · `SIGNED ON` · `ACTION`

Status vocabulary on rows: `Not opened` · `Opened, not signed` · `Declined` · `Signed`.
Row actions: `Download` · `Remind` · `View reason` (for declined).
Bulk actions: `Download all signed payslips` · `Remind 5 employees` / `Remind 5 pending`.
Toast: `Sent to 24 employees - they've been notified to e-sign.`

---

## 8. Sent for signature — batch tracker (RCM p1 panel D2)

Rows: `BAT-0318` `Payslips - August 2026` `24 employees` `18/24 signed` `In progress` `Sep 18` `Track`
`BAT-0314` `Loan agreements` `6 employees` `6/6 signed` `Completed` `Sep 14`
`BAT-0312` `Penalty decision notices` `12 employees` `5/12 signed` `In progress` `Sep 12`
`BAT-0309` `Asset handover — Zone 3` `9 employees` `9/9 signed` `Completed` `Sep 09`
`BAT-0305` `Investigation notice — E-1063` `1 employee` `0/1 signed` `Waiting` `Sep 05`
`BAT-0301` `Payslips - July 2026` `23 employees` `22/23 signed` `Has declines` `Aug 18`

---

## 9. Reminder drawer (RCM p1 panel D3)

Title `Remind 5 employees`. Channel chips `App notification` · `SMS` · `Email`.
Preview card: `Reminder: your August 2026 payslip is waiting for your e-signature in the MGGO app.`
Draft row: `E-1120 - Payslips - August 2026 - declined Sep 19, 10:42` + `Download`.
Footer: `Cancel` (outline) · primary `Send reminder`.

---

## 10. Declined reason modal (RCM p1 panel D4)

Title `Declined by Employee E`; line `E-1120 - Payslips - August 2026 - declined Sep 19, 10:42`; heading `REASON GIVEN`; body `Admin deduction of 15 KD is not correct — I was on approved paid leave that day.`
Footer: `Close` (outline) · `View audit trail` (link) · `Remind`.

---

## 11. Incoming hub (RCM p2 panel 1)

Tabs `Incoming` | `Outgoing`; chips `Your access` · `Sender & Receiver`; subtitle `You receive and handle`.
Section `Queues waiting on you` / `Needs your action`. Toolbar `Oldest first` + primary `Upload an incoming document`.
Second toolbar row: `All zones` · `Date range` · `Due: Any` · search.

Queue rows: title, due badge, sub-line, and a `Review` action:
| Title | Due | Sub-line |
|---|---|---|
| `Loan request` | `3 days` | `From: Employee A - then Finance` |
| `Annual leave - 5 days` | `2d` | `From: Employee B` |
| `Complaint` | `2 days` | `Confidential - sender shown only after opening` |
| `Laptop replacement` | `1 day` | — |
| `Sick leave note — 3 days` | `Today` | `From: Employee D` |

Category chips: `Leave` · `Asset` · `Fuel` · `Sick & accident` · `Fuel Refund` · `Loan` · `Complaint` · `Documents` · `Salary Justification`.

**Upload an incoming document** modal — fields: `CATEGORY` (select `Sick & accident`), `EMPLOYEE ID` (`E-1063`, helper `From the system: Employee C - Rider - Zone 2`), `SUBJECT`, `DATE RECEIVED` (`26/09/2026`), `ATTACHMENTS` (file list `doctor-note-e1063.pdf - 220 KB` + remove). Toggle `Start the approval route now` + `Routes to HR review, then Operations & Fleet.` Footer: `Cancel` · `Upload and log` (primary).

---

## 12. Incoming — Loan list + detail (RCM p2 panel 3)

Breadcrumb `Request & Complaint / Incoming / Loan` + `< Back to Incoming`; title `Loan requests`; subtitle `Requests waiting on you, oldest first`.
Tabs `Waiting on you 2` · `Forwarded to me 1` · `Handled by me 14` · `All loan requests 34`. Filters `All zones` · `Date range` · `Due: Any` · search. chip `YOU RECEIVE`.

List columns: ID, name, `LOAN AMOUNT`, `REPAYMENT PERIOD`, status line, `Review`.

Detail: header `LN-0142 - submitted Sep 19`; tabs `Request details` | `Approval route`.
Blocks: `SENDER` (`Employee A`, `Rider - Zone 3 - E-1041`, `View profile`), `RECEIVER` (`You (HR)`), `LOAN AMOUNT` `600 KD`, `REPAYMENT PERIOD` `6 months`, `INSTALMENT STARTING MONTH` `October 2026`, `100 KD / month`, `REASON GIVEN BY THE SENDER`, `ATTACHMENTS` (`rent-agreement.pdf`, `civil-id-copy.pdf`), `Your decision` + `Comment (required to reject)`, `Comments on this request (1)`.
Footer: `Approve` (primary) · `Reject` (destructive) · `Forward` (outline).

`Approval route` stepper: `Employee A submitted` → `Line manager approved` → `HR review - you` → `Finance` → `CEO`.
`Forward request` modal: `FORWARD TO` (`Rania S — Accounts - Manager`), helper text, footer `Cancel` + `Forward`.
`Reject` modal: title `Reject this loan request?`, description `This ends the request. Employee A will see your comment as the reason. This can't be undone.`, fields `YOUR COMMENT` + `NOTE FOR THE COLLEAGUE (REQUIRED)`, footer `Cancel` + destructive confirm.

Approved state: banner `Approved - sent to Finance for the next step.`, `Next: Finance`.

---

## 13. Incoming — Confidential complaint (RCM p2 panel 5)

chip `YOU RECEIVE` + `• In review`; header `CMP-0229 - submitted Sep 21`.
Warning: `Confidential complaint — the sender's identity was revealed to you when you opened it. This view is logged.`
Tabs `Complaint details` | `Resolution route`.
Blocks: `SENDER` (`Sana M`, `Rider - Zone 1 - E-1102`), `CATEGORY` `Payments`, `SEVERITY` `High`, `AGAINST` `Accounts`, `SUBJECT`, `COMPLAINT MESSAGE`, `ATTACHMENTS`, `Your response` (`Response — details & justification (visible to the employee)`), `Closing remark`, `Comments on this complaint (0)`.
Footer: `Send response` (primary) · `Forward` (outline) · `Escalate` (warning).
`Resolution route` stepper: `Submitted` → `Routed to Accounts` → `Accounts review - you since Sep 21`.

---

## 14. Build notes derived from this spec

- Source badges (`From the system` / `You enter` / `Fixed` / `Signed by a person`) are a **first-class UI element** on every field row in the template builder — not a tooltip.
- The step-3 bulk review must render **invalid rows in place** with a `Replace` affordance and a `need fixing` count; nothing is dropped.
- Status vocabulary is exactly `Not opened` / `Opened, not signed` / `Signed` / `Declined` — `opened` and `not_opened` are derived, never new enum members.
- Batch identifiers are `BAT-####`; individual e-sign requests keep `SIG-####`.
- Arabic subtitles exist under each template title and on `Employee Details` (`تفاصيل الموظف`) and `From the system` (`من النظام`); the Arabic strings are rendered from the template's own `title_ar` / field labels, not hard-coded.
