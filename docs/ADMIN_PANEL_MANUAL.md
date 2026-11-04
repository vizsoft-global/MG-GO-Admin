# MG-GO Admin Console — User Manual

**Administrator and operations guide**

| Item | Detail |
|---|---|
| **Document title** | MG-GO Admin Console — User Manual |
| **Applies to** | MG-GO Admin console (`dpdadmin-prod.vercel.app`), the office side of the MG-GO delivery platform |
| **Version** | 1.0 |
| **Date** | 4 November 2026 |
| **Audience** | Operations, HR, payroll, fleet and administration staff — and the client's implementation team |
| **Companion** | *MG-GO / Musallam Delivery — User Manual* (`docs/USER_MANUAL.md`) covers the rider app. This document covers the console only. |
| **Source of truth** | Written from the console's routes, menu registry, permission catalogue and in-code English strings. No screenshots. |

## About this manual

The MG-GO Admin console is the office side of the delivery platform. Everything a rider does on the phone — being created, approved, rostered, monitored, verified, paid and answered — has a screen here.

The manual is organised the way the work actually arrives, not alphabetically:

- **Part I** gets a new staff member signed in and productive: what the console does, how it is laid out, and what their account can and cannot see.
- **Part II** is the people file: creating an employee, approving them, and controlling their access.
- **Part III** is the working day: the live map, delivery verification, reconciliation, exceptions and performance.
- **Part IV** is HR in practice: requests, office visits and electronic signatures.
- **Part V** is the fleet, **Part VI** is money, **Part VII** is communication, **Part VIII** is the dashboards management asks for, and **Part IX** is administration.
- **Part X** holds the permission matrix, status glossary, worked recipes, troubleshooting, and an honest note about what could not be verified.

> **How this manual was produced.** Every screen name, tab, column and message quoted below is taken from the console's own English text. Where a behaviour is decided by a setting rather than by code, the manual names the setting. No live session was run while writing it; Appendix E records exactly what that means and what the client still has to decide.

#### Conventions used

| Convention | Meaning |
|---|---|
| **Bold** | A screen, tab, column, field or button as it appears in the console — **Verify & approve**, **Shift attendance**, **Allowed distance**. |
| `Monospace` | A technical identifier — a route, a status key, a collection name. |
| 1. 2. 3. | Steps to perform in order. |
| > Note / Caution | Changes the outcome, or a thing staff must not do. |
| Paths | Written as menu breadcrumbs: **OperationsHub → Delivery rules**. |

## Part I — Getting started

### 1. What the console does

| The console is responsible for | Where it lives |
|---|---|
| Creating, approving and controlling every rider account | **Employees**, **EmployeeDesk** |
| Publishing the weekly shift schedule and policing attendance | **OperationsHub → Shift attendance** |
| Watching the fleet live on a map | **Live tracking**, **Live tracking V2** |
| Verifying the deliveries riders record and matching them to restaurant reports | **Deliveries**, **DPD Verification**, **Order reconciliation** |
| Reviewing rejected and cancelled orders, and conduct incidents | **Order exceptions**, **Wrong Actions** |
| Setting the targets and bonuses a rider sees on their phone | **Delivery rules**, **Incentive rules**, **Driver App** settings |
| Calculating and exporting pay | **Payroll**, **Payouts**, **Earnings** |
| Answering riders, booking office visits and collecting signatures | **EmployeeDesk**, **Visit Slots**, **E-Signature** |
| Running the fleet: vehicles, fuel, kit, service, accidents | **Fleet Hub**, **Fuel**, **Assets**, **Service**, **Accident** |
| Reporting to management and to the client | **Rider Operations V2**, **Client Portal V2**, **Performance**, **Activity logs** |

The console never talks to the rider directly: every action either changes what the app shows or records what the app sent.

### 2. Signing in and finding your way

1. Open `https://dpdadmin-prod.vercel.app` in a current browser.
2. Sign in with the staff email and password issued by the super administrator. Staff accounts are separate from rider accounts; neither can be used in the other product.
3. The console opens on **Apps**, the launcher. Each tile is a module you have permission to open.
4. The left rail is the permanent menu. A module with sub-pages expands in place; the group headings are **Overview**, **Operations**, **OperationsHub**, **EmployeeDesk**, **Fleet**, **Visit Bookings**, **Settings** and **System**.
5. Use the language switch for English or Arabic. Arabic mirrors the layout right-to-left; the data is identical.

> Note: if a module a colleague uses is missing from your rail, your role does not include its permission — see Chapter 3. It is not a version difference.

#### 2.1 The anatomy of every page

Almost every list page in the console is built the same way, so learning one teaches you all of them:

| Region | What it holds |
|---|---|
| **Header** | Page title, one-line subtitle explaining the page's job, and the primary action (**Add employee**, **Create notification**, **Upload schedule**). |
| **KPI strip** | Three to seven count cards. In several modules a card is a shortcut: clicking it filters the table below. |
| **Filters** | Search box, dropdowns and date ranges. Filters are reflected in the address bar, so a filtered view can be bookmarked or shared. |
| **Table toolbar** | **Columns** (choose which columns show, in which order), **Export**, **Refresh**, and view switches such as list or grid. Column choices are remembered per person. |
| **Table** | Sortable columns; the funnel on a column header filters that column. Grouping is available where a column has a small set of values. |
| **Pager** | `from–to / total` with previous and next. Grouped tables page inside each open group. |
| **Dialogs** | Multi-step actions open as dialogs. The confirm button sits in the footer with the title, and **Close** sits top-right. |
| **Toasts** | Every save, approve, export and failure reports as a toast in the corner. A toast that says *Could not…* is the error to read first. |

Three habits make the console fast: filter with the column funnel rather than scrolling, set your **Columns** once (it is remembered), and press **Export** when you are about to discuss numbers — the export matches the screen, including filters and column order.

### 3. Accounts, roles and permissions

#### 3.1 Four kinds of staff account

| Kind | What it means |
|---|---|
| **Super administrator** | Everything, including staff roles, permissions, settings and both maintenance switches. Not removable by anyone but another super administrator, and the last one cannot be removed. |
| **Full access (manager)** | Every module the permission catalogue defines — effectively the whole product, without the super-administrator-only settings. |
| **User** | Only the modules an administrator ticked for that person. This is the right account for a defined job. |
| **Partner (client)** | Read-only, limited to one client project, with riders' phone numbers hidden and no ability to change data. |

#### 3.2 Changing someone's access

1. **Settings → Roles & Permissions**.
2. Pick the person on the left.
3. Choose the **role** and the **access kind** (Full access, User, Partner).
4. For a **User**, tick the modules. Each tick corresponds to a permission slug such as `drivers.manage` or `payroll.manage`; a module may appear as view-only or as view-and-edit depending on the slug granted.
5. Save. Access applies on the person's next page load; a change to a super administrator's own privileges signs them out so the new claim is picked up.

A partner account also carries a **project key** (Keeta, Americana, Five Guys, or Unassigned). That key decides which riders, which portal and which reports the account can see — a partner cannot widen it themselves.

#### 3.3 Access requests

When someone without an account tries to sign in, the console records the request in **System → Access Requests**. Approving there creates the staff record; the person still needs a role before they can do anything.

## Part II — People

### 4. The Employees list

**Operations → Employees** is the master list. Everything else in the console — payroll, live tracking, deliveries, fuel, assets — joins to a row here.

- The first column is the **Client ID**; the **MG ID** is the identifier the rider types into the app. They are different fields and both matter.
- Each row carries the account status (active, pending, inactive, suspended, archived) and, beside it, the HR **Employee Status** (running, leave, absent, terminated…).
- The toolbar holds **Columns**, **Export**, **Archive**, **Bulk import**, **Refresh** and **Add employee**. The pager sits at the end of the same row.

**Filters** worth knowing: project, zone, restaurant, vehicle type, employee status, section, nationality category, and the free-text search across name, MG ID and Client ID. Filtering by **Unset** project is how you find riders nobody has assigned yet.

> Caution: **Archive** hides a rider and stops their passcode working, but keeps the history payroll may need. **Delete** is permanent and frees the MG ID and mobile number — it needs the *Bulk delete employees* permission and the MG ID typed back to confirm. Archive first; delete only for records created by mistake.

#### 4.1 Exporting

**Export** opens a dialog where you choose the scope (the filtered list, or only ticked rows), then the columns. Presets are **Identity only** and **Include app code**; the second adds the 6-digit passcode, so leave it off unless you are producing a login handout. The file is a CSV that opens directly in Excel.

### 5. Creating an employee

**Add employee** opens a form in five sections. Complete them in this order:

| Section | What to fill |
|---|---|
| **Basic Details** | Full name, mobile, civil ID, passport, nationality, sponsorship, date of birth, joining date. |
| **Assignment** | **Zone**, **Restaurants** (one or more), **Vehicle**, **Vehicle type**, **Client ID**, **Platform**, **Project**. |
| **Operations** | Section, job title, driver status, off-day structure, and the operational flags. |
| **Driver Status** | The starting account status — normally pending until approval. |
| **Restaurants** | Optional when a zone is assigned: a rider needs **a zone or at least one published restaurant**. |

Then **Create Employee**. Two outcomes matter:

- **Success** — *Driver registered with ID {code}*. The rider cannot sign in yet: they still need **Verify & approve**.
- **Conflict** — if the MG ID, mobile, civil ID or passport is already held, the console opens a conflict dialog naming the holder. It distinguishes a live employee, an unapproved profile (invisible in the Employees list), an archived profile, and a record already on the roster, and offers **Open record** so you can release the value deliberately instead of guessing.

> Note: document upload needs Cloudflare R2 to be configured (**Settings → Cloudflare R2**). If it is not, the form says so and still lets you create the rider without documents — you can upload them on the record afterwards.

### 6. Bulk import

**Bulk import** is for twenty riders, not two. Use it for a new contract intake or a mass update.

1. **Download sample template** — one workbook with a **Drivers** sheet and a **Guide** sheet, plus reference sheets for **Restaurants**, **Zones**, **Partners** and **Companies**. The guide documents every column and the cell rules.
2. Fill it in. Two rules decide everything:
   - a **blank cell keeps** the stored value (an update never wipes a field by omission);
   - a **dash `-`** clears the value.
3. Upload. Every row is validated and shown as **Ready** or **Failed** with the reason (unknown zone, ambiguous ID, missing assignment, duplicate in file).
4. Tick the rows to apply — running an import does not have to mean applying all of it.
5. **Import**. The job reports progress, and can be paused and resumed.

Afterwards the import log lists each row with **Undo**, **Redo**, **View** and **Edit**. A whole batch can be undone and redone, skipping rows that are already in that state — which is what makes a bad spreadsheet recoverable without touching the database.

**Export employees** uses the same workbook shape, filled from the current employees, so it doubles as a template for a mass edit: export, change a column, import.

### 7. The employee record

Open a row and the record is twelve tabs. Everything the console knows about that person is here.

| Tab | Use it for |
|---|---|
| **Private Information** | Identity, employee status, bank and salary sections, each collapsible. This is where the fields the payroll sheets read are corrected. |
| **Documents** | The identity pack — the header counts how many of the six standard documents are on file. Upload, replace, download, and see expiry. |
| **Attendance** | The rider's attendance history and leave rows. |
| **Assets** | Kit issued to this rider. |
| **Earnings** | The rider's earnings and incentive rows. |
| **Loan** | Balance, instalments and status. |
| **History** | Every change to the record, who made it and when. |
| **Location** | Last known positions. |
| **Activity** | What the rider has done in the app. |
| **Login Verification Details** | The daily identity photos, and the per-driver exemption switch. |
| **Devices** | Phones this rider has signed in on, with **Force update once**. |
| **Service / Vehicle** (where shown) | The vehicle currently assigned and its service history. |

The header carries the identity block (initials, MG ID, name, status pill) and the actions: **Verify & approve**, **Archive driver**, **Delete employee**, and **Edit**.

### 8. Approving a rider and issuing the passcode

This is the single most important step in the console: it converts an employee record into a working app login.

1. Open the record and check the prerequisites. Approval refuses, with a specific message, when something is missing:

| Refusal | Meaning |
|---|---|
| *Complete identity fields (name, mobile, civil ID, MG ID) before approving* | One of the four identity fields is blank. |
| *Assign a zone or at least one published restaurant first* | No operational assignment. |
| *This phone is already registered* / *civil ID* / *MG ID is already in use* | The value belongs to another record. |
| *This driver is already approved* | The intake is already linked. |
| *You do not have permission* | Your role lacks the approve permission. |

2. Tap **Verify & approve**. The console asks: *Create the driver account, activate them, and generate a 6-digit app passcode?*
3. Confirm. The toast reads **Driver approved — passcode ready** and the passcode appears on the record.

The record then shows **Driver App Passcode** with **Show**, **Copy** and **Regenerate**. Two rules:

- **Regenerate is immediate.** The old passcode stops working the moment you confirm — only do it when the rider is expecting the new one.
- **Share it privately.** The passcode is the rider's login; the console is the only place it exists.

Until the record is active the panel reads *Passcode is generated automatically once the driver is set to active*.

### 9. Controlling an account

Five controls decide whether a rider can work. They live together on the record on purpose.

| Control | Effect on the rider app |
|---|---|
| **Account status** | Only **active** riders can sign in. *Inactive* and *suspended* are refused with their own messages. |
| **Block** + reason | Sign-in refused, and the reason is printed on the phone. |
| **Freeze** (from / until + reason) | Refused inside the window; the phone shows the reason and the end date. |
| **Archive** + reason | Hidden from the active list and unable to sign in at all. Reversible from the same screen. |
| **Login photo** | Per-driver exemption from the daily blink-and-photo check. |

Two device-level controls sit underneath:

- **Force update once** — the next sign-in from that phone must be on a build at or above the number you set.
- **Release session** — frees the single-device binding so a replacement phone can sign in without the rider finding the old one.

> Caution: blocking and freezing are recorded against the rider's account and are shown to them. Write the reason as if the rider will read it — because they will.

### 10. Documents, compliance and expiry

Three screens keep the paperwork current:

| Screen | Job |
|---|---|
| Employee record → **Documents** | The identity pack for one person: the six standard documents plus extras, with expiry and download. |
| **Operations → Compliance Upload** | Bulk upload of the daily Invalid / Rejected / Cancelled rows operations reconciles per rider-day. The template columns are documented on the page; nothing is written until you press **Apply**, and every row is validated as **Ready**, **Unknown rider**, **Ambiguous ID**, **Invalid day**, **Invalid number** or **Duplicate row**. |
| **Operations → Document expiry** | The renewal worklist. Documents are grouped by expiry window; each row opens the driver, and the expiry date can be corrected in place. |

Check the expiry worklist weekly: a lapsed registration is a rider who cannot legally work, and the same date is visible to the rider on **Vehicle → Documents**.

## Part III — Daily operations

### 11. Live tracking

**Operations → Live tracking** is the classic map with three tabs: **Live**, **History** and **Activity**.

- **Live** shows every rider reporting a position, with a **Fleet overview** strip (total drivers, live tracked, in progress) and filters by zone, restaurant, partner and status. A rider marker opens a card with the rider, their vehicle, the time of the last fix and the open delivery.
- **History** replays a chosen rider's day: pick the rider and the date, and the trail is drawn with the timings.
- **Activity** is the event feed for the same window.

Use **Fullscreen** for a wall display. Positions refresh themselves; the strip says so while it is refreshing.

### 12. Live tracking V2

**Operations → Live tracking V2** is the operations rail built for the floor: a full-bleed map with status chips, restaurant pins, and a side panel of filters — restaurant, company, schedule status — plus the duty counts.

Each rider card shows the scheduled window, the Kuwait login time, the grace period, any approved schedule change, and flag badges (early drop, out of zone). The insights rail carries zone distribution, today's alerts and the recent event feed.

> Note: a rider whose phone has stopped reporting drops off the map instead of being shown at a stale position. An empty spot means *no fix*, not *idle*.

### 13. Deliveries and verification

**Operations → Live Deliveries** is every delivery record the riders filed.

- **Filters**: status, **Integrity flags** (**Early drop**, **Outside zone**, **Photo mismatch**), and a search across driver, order and delivery ID.
- **Row detail** shows the evidence — pickup photo, delivery proof, the GPS points — and the **timeline**: **Created**, **Picked up**, **Delivered** or **Cancelled**, then **Checks**.
- **Verification** is the action that turns a recorded delivery into money. Until it is verified it does not pay and does not count towards the rider's target.
- **Orders Report** produces per-driver daily counts for a Kuwait window, noting that overnight shifts still land on the day they started.

Work the flags first: an early-drop or photo-mismatch row is the one that needs a human decision before it is approved.

### 14. Order comparison (AM vs MGGO)

**Operations → Order reconciliation** compares the client's AM sheet with what MGGO recorded.

1. **Upload AM file** for the month.
2. Choose the range — **This month** or **Custom** — and **Apply**. The first open of a month scans both sides and takes longer than later opens; the page says so while it works.
3. Read the comparison: **Riders compared**, **AM orders**, MGGO counts and the per-rider difference. Matching is on **MG ID only**.
4. **Commit** the run when it is right. A committed run can be undone and redone.
5. **Download report (Excel)** for the meeting. The report is always the whole month — filters are ignored by design.

The unused list tells you which AM rows matched nobody: usually a rider who has not been created yet.

### 15. DPD verification

**Operations → DPD Verification** matches what the restaurant reported against what the rider logged.

1. **Add verification** — pick the rider, the service date and the restaurant, then enter the count the restaurant reported.
2. Save. The row auto-reconciles against the rider's own records, and eligible earnings follow.
3. The list can be exported whole, or as **Restaurant Master**, **Zone Master**, **Partner Master** or a **Sample Import** sheet; **Bulk import** takes the same shape back, and **Import history** shows every batch with its result.

This is the screen that resolves "the restaurant says twelve, the rider logged ten" before it reaches payroll.

### 16. Order exceptions

**Operations → Order exceptions** is the queue of cases riders file when an order was rejected or cancelled against their count.

- **KPI strip**: Pending, Approved, Rejected, Total, plus **Rejected orders** and **Cancelled orders** totals.
- Tabs: **All**, **Pending**, **Approved**, **Rejected**; search by rider or order; filter by **Kind**.
- Opening a case shows the rider's evidence (up to five photos), the reason and the order ID.

Three decisions are possible: **Approve** (the order is restored to the rider's count), **Reject** with a reason, or approve with a review note. Approving is the difference between a rider being paid and not — read the photo.

### 17. Wrong Actions

**Operations → Wrong Actions** is the conduct register. Each incident records the driver, zone, type (**Delay**, **Zone breach**, **Hygiene failed**, **Uniform**, **Other**), **Severity** (**Low**, **Medium**, **High**) and the date.

- The KPI strip counts total incidents, high/medium/low, this week, the **Weighted Total** and the number of drivers involved.
- A row opens the incident record with its evidence and its effect on the conduct score.

An incident filed here appears on the rider's own **Wrong Action** screen immediately — so file it with the evidence you would be willing to show them.

### 18. Performance

**Operations → Performance** is the driver-quality view: delivery efficiency, utilisation and compliance in one place, with tabs for **Period**, **Live**, **Analysis** and **DPD**.

The operations views — **Overview**, **DPD & Efficiency**, **Riders' Analysis**, **Top & Bottom** and **Outsource** — carry the metrics the client's SOP defines: orders, working days, DPD, UTR (orders per attendance hour), average delivery time, and efficiency against target. Ranges are preset (**Last 7 days**, **This month**) or custom, and every view exports to Excel with the same columns it shows.

Two measurement rules worth remembering when a number is questioned:

- **UTR** is orders divided by attendance hours, so hours without orders stay in the denominator.
- A zero or missing denominator prints **—**, not 0, and that rider leaves the ranking rather than appearing at the bottom.

### 19. Shift attendance and rosters

**OperationsHub → Shift attendance** is where the week is published. The rider app will not let anyone go on duty without a shift, so this module gates the whole day.

The module has five screens:

| Screen | Job |
|---|---|
| **Shift attendance** (setup) | Thresholds, **Zone staff** (which staff see which zones), and **Assign restaurants to zones**. |
| **Upload weekly schedule** | The roster itself. |
| **Schedule changes** | Change requests, approved or rejected. |
| **Alerts** | The day's exceptions, with acknowledgement. |
| **Report** | Scheduled against worked hours, with export. |

#### 19.1 Uploading the weekly schedule

The subtitle states the rule: *one row per rider per day. Shift 1 and shift 2 on the same date become a split shift.*

1. **Download template** — a **Schedule** sheet and a **Guide** sheet. The example IDs in it must be replaced with real MG IDs before upload.
2. Fill one row per rider per day. An **OFF** day is a row with no working hours; a split shift is two rows for the same rider and date.
3. Upload and read the preview: every row is **Ready**, **Failed** or already **Written**. Nothing is saved until you press **Apply**.
4. Apply. Roster days lock the rider's own shift submission, and the rider's Home screen shows the published window.

#### 19.2 Schedule changes

A rider or a supervisor can request a change. **Approved** changes are what the live map, the alerts and the report read; a pending or rejected request leaves the uploaded shift untouched. That distinction is the whole point of the screen — nothing silently moves under a rider.

#### 19.3 Alerts

**Alerts** lists the day's exceptions and lets you acknowledge each with an outcome:

- **no login** after the grace period,
- **late login**, **early logout**,
- **early drop** (near the restaurant, or under the minimum minutes),
- **missing pickup proof**,
- **far from customer**.

Acknowledging is what closes the loop: the evidence stays, and the outcome records what the office decided. The 15-minute sweep writes these alerts automatically; you do not have to watch the map to catch them.

#### 19.4 Report

Filter by date range, zone, restaurant, company and rider, then **Export Excel**. The sheet carries scheduled hours beside worked hours and names who approved any schedule change — the row to quote when attendance is disputed.

### 20. Attendance thresholds, worktime and driver shifts

Three smaller screens complete the attendance picture:

| Screen | What it does |
|---|---|
| **OperationsHub → Attendance thresholds** | **Late grace**, **Early out grace**, **Offline alert**, **Auto checkout**, **GPS stale** and **Min GPS accuracy**, plus the **Performance score weights** (delivery, utilisation, compliance and the exception penalty). The page notes that the weights are provisional until the client signs off. |
| **Operations → Worktime** | Daily hours from three sources side by side — admin logs, app attendance and GPS — with a **Validation** column (**Present**, **Unvalidated**). This is how a paid hour is confirmed before payroll. |
| **Operations → Driver shifts** | Every shift plan a rider submitted, read-only, filtered by date, zone and partner. |

**Auto checkout** deserves a note: it is the number of minutes of continuous offline or out-of-zone time before the system checks a rider out. If riders report being logged out unexpectedly, read this value before anything else.

### 21. Zones, restaurants, partners and groups

These four catalogs are the vocabulary the rest of the console uses.

| Screen | Holds | Notes |
|---|---|---|
| **OperationsHub → Zones** | Delivery zones with their polygons, entry/exit/dwell rules, and inclusion or exclusion geofences | Bulk actions (**Mark active**, **Mark inactive**, **Delete selected**) act on a ticked set. A zone is what a Keeta rider clocks in against. |
| **OperationsHub → Restaurants** | Merchants under the delivery partners, with their address, pin or geofence, publish state and partner link | Only **published** restaurants can be used for check-in and pickup. |
| **OperationsHub → Partners** | The delivery partners riders are assigned to | Deactivating a partner does not delete its restaurants or riders. |
| **OperationsHub → Driver groups** | Reusable groups of riders for notifications and operations | Groups are the fastest way to send a message to a subset of riders. |

> Caution: a zone polygon is legal evidence — riders are checked in and flagged against it. Draw it from the client's map, not from memory, and change it outside peak hours.

## Part IV — Requests, visits and signatures

### 22. EmployeeDesk — the request queue

Everything a rider raises from **Help & support** on the phone arrives in **Operations → EmployeeDesk**. The hub is the front door; the queues are behind it.

#### 22.1 The hub

The hub is organised into **Request types** and **Operations**:

| Request type | Queue it opens |
|---|---|
| **Leave** | Annual, emergency and unpaid leave |
| **Sick leave** | Sick and accident absence, with evidence |
| **Asset** | Gear, SIM, bike and replacements |
| **Fuel** / **Fuel refund** | Reimbursement claims and rejected-fill refunds |
| **Loan** | Advances and loans, with the repayment plan |
| **Document** / **Document re-upload** | Requests for documents, and re-uploads the office asked for |
| **Complaint** | Complaints about a store, a customer or a condition |
| **Salary justification** | Pay queries the rider wants explained |

#### 22.2 Working a queue

Open **All requests** (or **Incoming** / **Outgoing**) and pick your **scope**: **Assigned to me**, **Forwarded to me**, **Handled by me**, or **All**.

Each row shows the request type, the rider, the status and the age. Opening one shows the rider's form, their attachments and the decision history.

| Action | What the rider sees |
|---|---|
| **Acknowledge** | The status becomes *Acknowledged*. |
| **Ask for clarification** | A badge appears in the app, and the request waits for **Your response**. |
| **Propose new dates** | Both the original and proposed dates, with accept or decline. |
| **Approve** / **Reject with a reason** | The final status and your reason in **My requests**. |
| **Set loan terms** | The approved amount, instalments and deduction start appear in the rider's request and their payslips. |
| **Forward** | The request moves into another team member's **Forwarded to me**. |

Two habits keep the queue healthy: acknowledge inside the response target (an unacknowledged request shows as **Overdue** on the rider's side), and always write a reason on a rejection — the rider reads it verbatim.

#### 22.3 Outgoing requests and templates

**EmployeeDesk → Outgoing** covers the requests the office raises *on the rider's behalf* — a penalty, a document requirement, a schedule change. The rider must acknowledge these, and they stay in the app until they do.

The **Request & Complaint** workspace also offers **Create from a template** and **Send to many employees at once**: every template works in bulk by uploading an Excel sheet of Employee IDs with the extra details, and progress is tracked as *signed x of y*.

### 23. Visit bookings — slots, calendar and reception

Office visits are booked by riders and managed here. **Visit Bookings** is a hub with two groups: **Manage** and **Configure**.

#### 23.1 Configure

| Screen | What you set |
|---|---|
| **Slot & availability** | The weekday slots: opening hours, services, slot length and how many riders each slot holds. |
| **Departments & desks** | The desk catalog and each desk's availability — this is the list the rider chooses from. |
| **Branches** | The locations and their working hours. |

Publishing here is immediate: the rider's booking screen shows live capacity, marking a slot **Full** when it is taken and *n remaining* when it is partly used.

#### 23.2 Manage

| Screen | Use it for |
|---|---|
| **All visits** | The full list with column filters (rider, department, status, slot, date) and department tabs. |
| **Calendar** | Day view (services as rows, times as columns, current slot marked), week view (capacity bars), month view (a heat table with the busiest services) and year view (twelve mini-months and the peak). |
| **Reception check-in** | The desk. The rider arrives with a **ticket** token from the app; reception checks them in, which moves the visit to *Checked in* and then *Completed*. |

A rider who cancels or reschedules on the phone releases the place immediately, so the calendar and the reception queue stay truthful without anyone chasing a spreadsheet.

> Note: **Reception is the screen that matters most.** A visit that is never checked in looks like a no-show in the reports even when the rider is standing at the desk.

### 24. E-signature

Documents that need a legal signature — loan agreements, payslip acknowledgements, accident declarations, policy acknowledgements — are produced, sent, signed and archived in **EmployeeDesk → E-Signature**.

#### 24.1 The screens

| Screen | Purpose |
|---|---|
| **Templates** | The document designs. A template is built in the **builder** from fields, sections and signature slots, and previewed on an A4 sheet. |
| **Send** | One request: choose the template, the rider and the dates, and edit any field value for that rider. |
| **Bulk** / **Batches** | The same document to many riders. Each batch lists its recipients and its own progress (*signed x of y*). |
| **Sent** | Everything issued, with per-request status. |
| **Signing** | The staff queue for documents awaiting a counter-signature. |
| **Waiting** | Requests blocked on the rider, or on a missing counter-signature. |

#### 24.2 The lifecycle

1. **Sent** — the rider gets a push notification and the document appears in **Documents to sign**.
2. **Opened** — the app records that the rider opened it.
3. **Signed by the rider** — they draw a signature and accept the legal declaration. Attachments the request asked for arrive with it.
4. **Counter-signed** — management signs in the **Signing** queue, inside the signature slot the template defines. A document is not final until the last required signature is in.
5. **Signed PDF** — the composed document with every signature is downloadable. If a staff signature is still outstanding, the download says so instead of failing silently.
6. **Declined / expired** — the document is void and a new request must be raised.

Every step is stamped with who did it and when. That audit trail is what makes the archive usable in a dispute — so never re-send a document to "fix" a signature; void it and raise a new one.

## Part V — Fleet

### 25. Fleet Hub

**Fleet → Fleet Hub** is the vehicle register: plate, chassis, model, type, year, ownership company and the rider it is assigned to.

What you can do from a vehicle:

| Action | Where |
|---|---|
| See and change the assignment | The vehicle's **Driver** field; clearing it releases the rider. |
| Upload and review documents | **Documents** tab — registration, health card, Baladiya card, with expiry. |
| See the service history and the maintenance schedule | **Service** tab and **Fleet → Service**. |
| Hand the vehicle to another rider | **Fleet → Handover**. |
| Record an accident | **Fleet → Accident**. |
| Review rejected fuel and asset requests | **Fleet → RJ** — the register of rejections, by type. |

The vehicle's plate and type are exactly what the rider sees on the **Vehicle** tab, so a wrong assignment is visible on the phone within a refresh — fix it here, not by telling the rider.

### 26. Fuel

**Fleet → Fuel** is one page with three tabs: **Fuel Log**, **Fuel Request** and **Fuel Refund**.

- **Fuel Log** — every fill, daily to monthly (custom ranges up to 31 days), with the card or chip used, litres, cost, station and odometer. The vehicle's monthly limit sits on the same row, which is how an unusual pattern shows itself.
- **Fuel Request** — approvals for fills that need one.
- **Fuel Refund** — cash claims where the rider paid and wants the money back.

A fill submitted from the app arrives here with its pump, odometer and receipt photos; approving a refund is what puts the money into the next payout.

### 27. Assets

**Fleet → Assets** has three tabs: **Assignments**, **Catalog** and **Asset Request**.

- **Assignments** — kit by rider, vehicle and zone, searchable by employee, plate or asset.
- **Catalog** — the stock itself and how many are held.
- **Asset Request** — the queue of things riders have asked for, with the approval steps.

Approving a request is what makes the item appear on the rider's **Assets** list, so the rider's screen and the stock count agree.

### 28. Service, handover, accidents and RJ

| Screen | What it does |
|---|---|
| **Fleet → Service** | Workshop records, **Cost analysis**, and the preventive maintenance schedule. Tabs: **Records**, **Cost analysis** and maintenance. A record moves through its stages until it is done or cancelled, and every record carries the odometer at the visit. |
| **Fleet → Service → bikes** | The bike programme: oil, front tyre, rear tyre, brake and chain, with the current odometer, today's distance and the assigned rider. |
| **Fleet → Handover** | The record of a vehicle passing between riders, with condition. |
| **Fleet → Accident** | Accident records across plates, plus the case register — reference and state (**Close**, **Pending**, **Delay**) — with attachments and the case history. |
| **Fleet → RJ** | **RJ** — rejected fuel and asset requests. Rejected fuel, refund and asset rows appear here with their type and the vehicle they belong to. |

Two things to know about the maintenance schedule:

- It is **per programme, not per vehicle**: oil, front tyres, rear tyres, brakes and chain each have their own interval and their own due date, so "the oil is due but the tyres are fine" is a normal state.
- A vehicle shows **Needs setup** until an approved interval applies *and* there is a baseline to count from. Until the intervals are stored and the baseline odometer import is run, the page legitimately reports setup work rather than a due date.

## Part VI — Targets, earnings and payroll

### 29. Delivery and incentive rules

Two modules define what a rider sees on their Home screen and what they can earn on top of base pay.

#### 29.1 Delivery rules

**OperationsHub → Delivery rules** — *define which verified deliveries count toward incentives*. A rule is scoped to a rider, a restaurant, a zone, a partner or a company, and carries the **DPD target**, the period and the validity window.

The same rules power the **Daily DPD target** card and the **Delivery rules** card in the app. Only verified deliveries count.

#### 29.2 Incentive rules

**OperationsHub → Incentive rules** — *target deliveries and reward amounts by zone, partner, or restaurant*. Each rule defines what unlocks it and what is paid above the target; the detail view is read-only, so changes are made by editing the rule.

#### 29.3 The DPD workspace

**Operations → DPD** gathers the four screens into tabs — **Restaurants**, **Delivery rules**, **Incentive rules** and **Calculation** — which is the fastest route when you are tuning one rider's economics end to end.

> Caution: a rule change reaches the rider's app on its next refresh, without a release. Announce a change to the target before you save it, or the first the rider hears of it is a lower bonus.

### 30. Earnings, payouts and the pay plan

| Screen | Job |
|---|---|
| **Operations → Earnings & Incentives** | The approved daily earnings and the wallet ledger for a date range: rows, total net (KWD), wallet approved, deliveries per rider and day. Read-only. |
| **Operations → Earnings calculation** | The rules that turn verified deliveries into money. This is where a rate or a band is corrected. |
| **Operations → Payouts** | Plan, approve and track payout runs. **New payout run** takes a period (start and end) and notes, creates a draft, and the run is then approved and tracked to completion. |
| **Payroll → Driver pay plan** | The base, the band rates and the penalties the rider's **Pay calculator** reads, saved per driver. It states the rule plainly: everyone earns the base; riders below the threshold drop to the low base; the floor is the minimum final pay. |

The pay plan is the screen that answers most rider pay queries, because the rider's own calculator uses the same numbers. If the two disagree, one of them is out of date — reconcile before replying.

### 31. Payroll

**Operations → Payroll** is the monthly workbook, and **Operations → Payroll Hub** is its front door.

| Tab | Contents |
|---|---|
| **Combined Payroll** | The SOP sheet: identity columns pinned on the start edge, the 31 day columns, then the ordered summary columns — working days, total orders, required and actual hours, efficiency, incentive and deduction columns. |
| **Payroll** | The summary sheet, one row per rider. |
| **Attendance & Orders** | The day grid where a status and an order count are edited. |
| **Application Attendance** | What the app recorded, for comparison. |
| **Requests** | Payroll-affecting requests — loans, advances, penalties. |
| **Settings** | Column configuration and the pay rules. |
| **HR Payroll** (`/payroll/hr`) | The HR sheet, one column per HR field, with periods that lock once approved. |

#### 31.1 Before you edit a month

- **The month is a snapshot.** The console computes it once and stores it; editing a day cell or a rule invalidates the snapshot and the next open recomputes. That is why the first open of a month is slower than the second.
- **Statuses carry money.** Setting a day to Absent, Leave, Sick, Accident, Terminated, Cancelled, New hire, Training, Phone issue, ID suspended or Vehicle issue changes both the pay for that day and the status the rider sees. Every edit is audited.
- **The export is the screen.** Same columns, same order, same number formats — which is what makes the workbook usable in a payroll meeting without reformatting.

#### 31.2 The day columns

Each day cell prints the rider's status for that Kuwait day and the order count behind it, and the shared legend colours them (active, three hours, six hours, OFF, sick/leave, accident, new hire, training, absent/terminated/phone/ID/vehicle). The legend is the key to reading any of the payroll tabs — learn it once.

## Part VII — Communication

### 32. Notifications

**Operations → Notifications** sends messages to the rider app — both as a push notification and as a row in the in-app inbox.

#### 32.1 The list

The module opens on **Recent**, with **History** beside it, and a KPI strip above: **Sent Today**, **Scheduled**, **Drafts**, **Recipients**, **Open Rate**, **Failed**, **Delivery Rate**, **Active Automations** and **Recent Activity**.

The list filters by tab (**All**, **Sent**, **Drafts**, **Scheduled**, **Failed**), by **Category**, and by a date range. Each row carries a **Title**, **Category**, **Audience**, **Status** and **Sent At**, and the audience count opens a dialog listing **Employee ID and the message each person received** — which is the answer to "did this rider get it?".

#### 32.2 Sending a campaign

1. **Create Notification**.
2. Write the **title** and **body**. Personalisation tokens are supported for imported recipient lists.
3. Choose the **audience**:
   - all live riders,
   - by **client project** (Keeta, Americana, Five Guys),
   - by **zone**,
   - by **status** (active, pending, suspended),
   - or an **imported list** of Employee IDs, driver codes or client IDs.
4. Preview the recipient count. A count of zero is almost always a filter that matches nobody — fix the audience, not the message.
5. **Send** now, or **schedule** it. The page warns that high-priority, emergency and broadcast sends may require approval.

#### 32.3 Templates and automations

| Tab | Use it for |
|---|---|
| **Templates** | Reusable titles and bodies, so the same message reads the same way every time. |
| **Automations** | Rule-driven messages — the classic example is a document that is about to expire. |
| **Analytics** | Delivery, open and click numbers per campaign. |

Two practical rules: keep the title under about forty characters so it is not truncated on a lock screen, and always check the audience count before sending — an accidental "all riders" is not recallable.

### 33. Support

**Settings → Support** holds the support categories and the message copy used by the support screens, which is what a rider sees when they raise a complaint or open a request. Treat it as content, not code: changing a category name changes it in the app.

A support conversation that needs a specific rider's context should start from the employee record, not from the support page — the record has the account state, the requests, the documents and the device history in one place.

## Part VIII — Dashboards and reporting

### 34. Rider Operations V2

**Operations → Rider Operations V2** is the workforce dashboard: *live workforce status across all projects*, dated and timestamped.

- The KPI cards are **Total riders**, **Working**, **On leave**, **Sick**, **Absent**, **Not marked** and **Accident**, with a status mix beneath them.
- **Every card opens the riders behind it.** Choosing one renders a roster directly under the status mix, titled *All Riders — {project}*, with a name or Employee ID search, a project select, a `shown / total` counter, **Export to Excel** and **Close**. Clicking the same card again closes it.
- The roster columns are Employee ID, Name, Project, Zone, Status, Joined and Phone — with Phone hidden for a partner account.
- Beyond the KPI strip the page carries the hiring outlook, the contract-end window and the leave planner for the selected period.

The project filter (All projects, Keeta, Americana, Five Guys, Unassigned) is the fastest way to answer "who is on shift for Americana today?" without opening the Employees list.

### 35. Client Portal V2

**Operations → Client Portal V2** gives each client a view-only window onto the riders assigned to them.

| Tab | Purpose |
|---|---|
| **Clients** | One card per portal: the client, their project, riders shared, contract fill, sections and document grants, and a **Before you publish** checklist. |
| **Users & access** | Every portal user with their role chip, remove, and **Add user**. |
| **Visibility rules** | Seven section switches per portal, saved on toggle — this is what decides which dashboard sections the client sees. |

**New client portal** is a five-step setup: client details (name, code, account manager, contracted headcount, contract dates, logo), projects and riders, the seven visibility switches, the document grid and privacy flags, and the invited users. Two routes out: **Save as draft** or **Publish & send invites**.

A portal is keyed by project, and one project belongs to one client. That is why two clients cannot accidentally share riders, and why the rider count on a card is the truth for that project.

### 36. Activity logs

**System → Activity Logs** records every administrative action with before and after values: the actor, the action, the entity and the timestamp. Filter by date, action and entity, then **Export CSV**.

When something has changed and nobody admits it, this is the first screen to open — it answers *who changed what, and to which value*.

## Part IX — Administration

### 37. Settings and catalogs

Almost every pick-list in the console is a catalog you maintain, not a fixed list.

| Screen | What it controls |
|---|---|
| **Branding** | Console and app branding assets, plus the login hint a rider reads. |
| **Driver App** | The rider application itself — see Chapter 38. |
| **Roles & Permissions** | Who can open what (Chapter 3). |
| **Staff access** | The allow-list of staff emails permitted to sign in. |
| **Driver devices** | Installed builds and sessions (Chapter 39). |
| **Sponsorships** | The sponsor companies offered on the employee form. |
| **Employee statuses** | The HR statuses the employee form and the payroll sheets read. |
| **Employee sections** | The sections (operational and non-operational) a rider can belong to. |
| **Nationality Category** | The nationality groups used in filters and payroll. |
| **Driver fields** | Custom fields added to the employee form and the export. |
| **Bank codes** | The bank list used by salary details. |
| **Companies** | The companies a rider is employed through. |
| **Vehicle types / Vehicle uses / Vehicle companies** | The vehicle vocabulary — a new type is a data change, and the app picks the label up without a release. |
| **Service types** | The service catalog used by Fleet → Service (parts and labour categories). |
| **Attendance thresholds** | Grace periods, GPS tolerances and the performance weights (Chapter 20). |
| **Support** | Support categories and message copy (Chapter 33). |
| **Cloudflare R2** | The private storage bucket for documents and photos. |
| **Menu Editor** | The menu layout per role. |
| **Languages** | The translation catalogue. |
| **Maintenance** | Puts the **console** into maintenance — only a super administrator can sign in. Separate from the rider-app switch. |
| **Data cleanup** | Housekeeping tools for stale rows. |
| **Activity Logs** | The audit trail (Chapter 36). |
| **Access Requests** | Pending requests to join the console (Chapter 3). |

> Caution: catalogs are live. Renaming an entry is safe — existing records keep their key and simply display the new label — but **deactivating** one hides it from new records while old ones keep showing it. Deactivate rather than delete.

### 38. Driver App settings — the switchboard for the phone

**Settings → Driver App** is the one screen that changes what every rider sees and must do, without a new app release. It is grouped into five blocks.

#### 38.1 Branding

| Field | Effect |
|---|---|
| **App title** | The name shown inside the app. |
| **App logo** | Login and profile logo (PNG, JPG, WebP or SVG; 128×128 or larger). |
| **Splash screen** | The portrait image shown on launch (max 5 MB). |
| **App icon** | The square home-screen icon (512×512 recommended). |

Every upload takes effect on the rider's next launch. **Reset to defaults** removes the uploaded assets and restores the shipped ones.

#### 38.2 Login photo verification

A fleet-wide switch: **Skip login photo for all drivers**. When it is off, each rider completes the daily blink-and-photo check unless their own record is exempt. The page states the current state plainly — *All drivers EXEMPT* or *Login photo REQUIRED* — because the wrong setting here is immediately visible to every rider.

#### 38.3 Driver app maintenance

| Control | Effect |
|---|---|
| **Maintenance mode** | Shows a full-screen message on every phone and blocks sign-in and in-app actions. |
| **Maintenance message** | The text the rider reads. Write the reason and the expected end. |

This is separate from **Settings → Maintenance**, which locks the console rather than the app. Use the app switch for a rider-facing outage, the console switch for system work.

#### 38.4 Delivery location check

**Allowed distance** in metres is the radius used when a rider logs a pickup and when they clock in against a restaurant. `0` disables the check. The hint is explicit: the rider must be within this distance of their assigned zone or one of their assigned restaurants.

#### 38.5 Delivery integrity

| Control | Effect |
|---|---|
| **Require check-in photo** | The rider must take a front-camera selfie inside a restaurant range before going on duty. |
| **Early drop threshold** (metres) | A delivery completed at or below this distance from the pickup is flagged **Early drop**. It is a review flag, not an automatic block. |
| **Order photo OCR check** | **Block mismatches**, **Warn only** or **Off**. The app reads the order number on the delivered photo on the device itself; in block mode a mismatch is refused unless the rider states a reason. |

These four values decide most "the app won't let me" calls. Before investigating a report, check them here — a radius of 100 m and a radius of 800 m produce completely different experiences.

### 39. Devices, storage, menu and housekeeping

| Screen | What it does |
|---|---|
| **Settings → Driver devices** | The fleet's phones: **Drivers**, **Critical**, **High**, **Outdated**, **No device** and **Sentry errors** counts, with tabs for **All**, **Critical**, **High**, **Outdated**, **On latest** and **Errors**. Each row is a phone with the build it runs and when it was last seen. **Force update once** blocks that phone's next sign-in until it updates. |
| **Settings → Cloudflare R2** | The private bucket used for rider documents and delivery photos. If it is not configured, uploads on the employee form and in the app fail with a message that says so. |
| **Settings → Menu Editor** | The menu layout per role — which modules sit where, and which are hidden. Use it to simplify a narrow role instead of granting fewer permissions than the job needs. |
| **Settings → Languages** | The translation catalogue for both languages. A missing key shows as a raw path in the interface, which is how an untranslated label is spotted. |
| **Settings → Maintenance** | Console-level maintenance. Only a super administrator can sign in while it is on. |
| **System → Data cleanup** | Housekeeping for stale or orphaned rows. Read the confirmation before pressing anything. |
| **System → Staff Assistant** | The assistant workspace for staff queries and generated reports. |

## Part X — Appendices

### Appendix A — Who needs which permission

Use this as the starting point when creating a **User** account. It is a practical grouping of the console's modules, not the full permission catalogue.

| Job | Modules they need |
|---|---|
| **Recruiter / HR officer** | Employees (view + manage), EmployeeDesk, Visit bookings, Documents, Document expiry, E-Signature (send), Sponsorships and Nationality catalogs |
| **Operations supervisor** | Live tracking and V2, Deliveries, Shift attendance (upload, changes, alerts), Order exceptions, Wrong Actions, Rider Operations V2, Notifications |
| **Verifier** | Deliveries (verify), DPD Verification, Order comparison, Order exceptions |
| **Payroll officer** | Payroll, HR Payroll, Payouts, Earnings, Earnings calculation, Worktime, Driver pay plan |
| **Fleet controller** | Fleet Hub, Fuel (log, requests, refunds), Assets, Service, Handover, Accident, RJ |
| **Fleet administrator** | The above plus Vehicle types, Vehicle uses, Vehicle companies, Service types |
| **System administrator** | Roles & Permissions, Staff access, Driver devices, Branding, Driver App, Cloudflare R2, Menu Editor, Languages, Maintenance, Activity logs |
| **Client / partner** | Client Portal V2 only, read-only, scoped to their project |

> Note: a permission tick grants a module; it does not grant data outside the person's project or zone. A supervisor restricted to one zone sees that zone, even with the module ticked.

### Appendix B — Status reference

#### B.1 Rider account

| Status | Where it comes from | Effect |
|---|---|---|
| **Pending** | Created but not approved | The rider cannot sign in; the record is not in the working list. |
| **Active** | **Verify & approve** | Sign-in allowed, passcode issued. |
| **Inactive** | Set on the record | Sign-in refused as *not active*. |
| **Suspended** | Set on the record | Sign-in refused as suspended. |
| **Blocked** | Block with a reason | Sign-in refused, reason shown to the rider. |
| **Frozen** | Freeze window | Sign-in refused inside the window. |
| **Archived** | Archive with a reason | Hidden and unable to sign in. |

#### B.2 Delivery

| Status | Meaning |
|---|---|
| **Pending** | Recorded by the rider, not yet verified. Does not pay. |
| **Verified** | Accepted by the office. Counts towards targets and pay. |
| **Rejected** | Refused; the rider can contest it with an Order exception. |
| **Cancelled** | Closed as cancelled, with a reason and proof. |
| **Early drop** | Flag: completed too close to the pickup, or too quickly. |
| **Outside zone** | Flag: recorded outside the assigned zone. |
| **Photo mismatch** | Flag: the OCR read a different order number than the one entered. |

#### B.3 Requests, visits and documents

| Term | Meaning |
|---|---|
| **Awaiting ack / Acknowledged** | Sent; seen and accepted. |
| **In progress / Solved / Overdue** | Being handled; closed; past the response target. |
| **Clarification needed** | Waiting on the rider's answer. |
| **Confirmed / Checked in / Completed** | A visit booked, arrived, and done. |
| **Opened / Signed / Awaiting counter-signature / Declined / Expired** | The five states of a signature request. |

### Appendix C — Worked recipes

#### C.1 A new rider starts tomorrow

1. **Employees → Add employee** — identity, zone, restaurant, project, vehicle. *(Or bulk import for a group.)*
2. Open the record → **Documents** → upload the identity pack.
3. **Verify & approve** → copy the passcode.
4. **OperationsHub → Shift attendance → Upload weekly schedule** — add the rider's week.
5. Send the passcode privately, with the shift and the restaurant to clock in at.

#### C.2 The client disputes last month's orders

1. **Operations → Order reconciliation** → upload the AM file for the month → **Apply**.
2. Read **Riders compared** and the per-rider differences. Matching is on MG ID only, so an unmatched row is usually a missing employee.
3. Export the report for the meeting.
4. If the difference is inside MGGO rather than the AM sheet, open **Deliveries** filtered to that rider and day and check the verification state of each row.

#### C.3 A rider says they were not paid for four orders

1. **Deliveries** → search the rider → filter that date → check each order's status (pending, rejected, cancelled).
2. If they were rejected, open **Order exceptions** and check whether a case exists; if not, ask the rider to file one with photos.
3. If they were verified, open **Earnings & Incentives** for the date and confirm the money was booked.
4. If the money is booked but missing from the payslip, the answer is usually a **deduction** (a loan instalment) — check the record's **Loan** tab before replying.

#### C.4 A rider cannot go on duty

Work in this order — the first four checks answer most calls:

1. **Employees** → the rider's account status and any **Block** or **Freeze**.
2. **Shift attendance** → is there a published shift for today, or must the rider submit one?
3. **Settings → Driver App** → **Allowed distance** and **Require check-in photo**.
4. The rider's assignment — does the record have a zone or a published restaurant? (Keeta riders use the zone.)
5. Only then **Driver devices**: an outdated build, or a session held by another phone.

#### C.5 Month-end payroll

1. **Worktime** — confirm every paid day shows **Present** rather than **Unvalidated**.
2. **DPD Verification** — make sure the restaurant counts and the rider counts agree.
3. **Payroll → Attendance & Orders** — correct the day cells that need it (every edit is audited).
4. **Payroll → Combined Payroll** — review required versus actual hours and the efficiency column.
5. Export the month, approve the period, then **Payouts → New payout run** for the period.

### Appendix D — Troubleshooting

| Symptom | First place to look | What usually explains it |
|---|---|---|
| A module is missing from the menu | **Settings → Roles & Permissions** | The role lacks the permission tick, or a saved menu layout hides it (Menu Editor). |
| A rider cannot sign in | **Employees** → the record | Account status, block, freeze, archive — in that order. |
| The passcode does not work | The record's passcode panel | It was regenerated; reveal the current one. |
| A rider signed in on a new phone but is refused | **Driver devices** / the record's **Devices** tab | Single-device rule — release the old session. |
| Riders report an outdated app | **Settings → Driver devices** | The **Outdated** tab lists them; use **Force update once**. |
| Uploads fail on the employee form | **Settings → Cloudflare R2** | Storage credentials are missing or expired. |
| Numbers look stale after a correction | — | The month (or page) is a snapshot; reopen the page to recompute. |
| A delivery does not pay | **Deliveries** | It is still pending, or it was rejected. Verify it or resolve the exception. |
| Attendance and payroll disagree | **Worktime** | A day is **Unvalidated**, or a schedule change was never approved. |
| A visit looks like a no-show | **Visit bookings → Reception** | The rider arrived but was never checked in. |
| A signature request is stuck | **EmployeeDesk → E-Signature → Waiting** | The rider has not signed, or a staff counter-signature is outstanding. |
| A notification went to nobody | **Notifications** → the campaign's audience | The filter matched zero riders; check the audience count before re-sending. |
| The Service page says *Needs setup* | **Fleet → Service** | No interval rule applies, or there is no baseline odometer to count from. |

### Appendix E — Assumptions, limitations and what could not be verified

| Question | Answer |
|---|---|
| Where did the content come from? | The console repository: its route tree, `MENU_REGISTRY`, permission catalogue and English string catalogue (`src/messages/en.json`). |
| Was the console exercised? | **No live session was run for this manual.** Nothing was created, approved, uploaded or sent. The procedures describe the code paths. |
| Are the screen names exact? | Yes — they are the console's own English labels. Quoted messages are the console's messages; where the product inserts a value (a name, a count) the wording is shown with a placeholder. |
| Is the Arabic interface covered? | The console is bilingual, but this manual documents the **English** labels only. |
| Is every module covered? | Every module in the menu is named. The deepest treatment is given to Employees, Shift attendance, Deliveries, Order exceptions, Payroll and Driver App settings — the screens staff use daily. Some specialist modules (Order comparison internals, HR Payroll column meanings, Service cost analysis) are described at working level rather than field by field. |

#### E.1 Behaviour that depends on configuration

The manual names the setting instead of a value, because the value belongs to the client and can change without a release:

| Behaviour | Where the client sets it |
|---|---|
| Check-in and pickup radius | **Settings → Driver App → Allowed distance** (`0` disables) |
| Whether a check-in selfie is required | **Settings → Driver App → Require check-in photo** |
| Early-drop threshold | **Settings → Driver App → Delivery integrity** |
| OCR mode (block / warn / off) | **Settings → Driver App → Order photo OCR check** |
| Daily DPD target and incentive rates | **Delivery rules**, **Incentive rules** |
| Late / early / no-login grace, auto checkout | **Shift attendance** setup, **Attendance thresholds** |
| Performance score weights | **Attendance thresholds** — flagged on the page as provisional until the client signs off |
| Slot capacity and opening hours | **Visit Slots → Slot & availability / Branches** |
| Request response targets (*Overdue*) | **EmployeeDesk → Settings** |
| Minimum app version and forced update | **Settings → Driver App → Force update**, **Driver devices** |
| Maintenance windows | **Settings → Driver App** (the app) and **Settings → Maintenance** (the console) — two separate switches |

#### E.2 Not exercised during this review

These paths are implemented but were not run, so the manual describes what the code does rather than what was observed:

- approving a real rider end to end (and the passcode handout);
- uploading a weekly schedule and applying it;
- committing an order-comparison run;
- sending a notification campaign to a real audience;
- composing a signed PDF after counter-signature;
- generating a payout run;
- exporting each module's Excel/CSV;
- the partner (client) view of the console.

#### E.3 Documentation that is out of date

`docs/DRIVER_APP_HANDOFF.md` and the rider app's `README.md` still describe a retired architecture — Supabase RPCs, phone + OTP bootstrap login, Control Tower chat, SOS tickets, hygiene task submissions, and in-app APK updates. None of those exist in the current product: the console and the app run on Firebase, sign-in is employee ID + 6-digit passcode, and the app is distributed through Google Play. Do not use those documents as a feature list.

#### E.4 Items to confirm with the client before publication

| # | Item | Why it needs a decision |
|---|---|---|
| 1 | Whether the check-in selfie is **on** by default at go-live | Changes what every rider must do at clock-in. |
| 2 | The **Allowed distance** in metres | Every pickup and clock-in depends on it. |
| 3 | The **early-drop** thresholds | They generate the flags the ops team reviews. |
| 4 | Whether the daily **identity photo** is required fleet-wide | It is the first thing a new rider meets. |
| 5 | The **emergency route** while the app's SOS button is a stub | The console has no emergency inbox; the manual points riders at the office number. |
| 6 | Which **client projects** are live (Keeta, Americana, Five Guys) | Project scoping decides rules, portals and reports. |
| 7 | The **performance score weights** | The page itself marks them provisional pending sign-off. |
| 8 | The **maintenance intervals** and the baseline odometer import for Fleet → Service | Until they exist, the page reports *Needs setup* rather than due dates. |
| 9 | An **Arabic review** of this manual | Only the English edition was produced. |

### Appendix F — Maintaining this manual

Both formats are generated from `docs/ADMIN_PANEL_MANUAL.md`:

- `npm run docs:admin` writes `docs/ADMIN_PANEL_MANUAL.pdf`
- `npm run docs:admin:docx` writes `docs/ADMIN_PANEL_MANUAL.docx`

Correct the markdown once, then rebuild both. When a screen changes, change the chapter that names it in the same commit — the console's `en.json` is the source of truth for labels.

| Revision | Date | Note |
|---|---|---|
| 1.0 | 4 November 2026 | First edition, derived from the admin console source. |

*End of manual.*













