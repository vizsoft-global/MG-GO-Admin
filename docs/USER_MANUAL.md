# MG-GO / Musallam Delivery — User Manual

**Rider application and administration console**

| Item | Detail |
|---|---|
| **Document title** | MG-GO / Musallam Delivery — User Manual |
| **Applies to** | MG-GO rider app (`com.musallam_delivery.app`, Android) · MG-GO Admin console (`dpdadmin-prod.vercel.app`) |
| **Version** | 1.0 |
| **Date** | 4 November 2026 |
| **Audience** | Riders (Part II), office and operations staff (Part III), and the client's implementation team |
| **Currency / locale** | Kuwaiti Dinar (KWD) · English and Arabic (`RTL`) |
| **Source of truth** | This manual was written from the two code repositories and their in-code UI text. No screen images are included. |

## About this manual

MG-GO is a two-part product. Riders use the **MG-GO rider app** on an Android phone to sign in, go on duty, record deliveries, watch their earnings, look after their vehicle and raise requests. Office staff use the **MG-GO Admin console** in a web browser to create and approve riders, publish shifts and delivery rules, answer requests, run payroll and monitor live operations.

This manual explains both parts in the order a reader needs them: what must be set up before a rider can start, how a rider works through a normal day, and which console screens produce the information the rider sees.

> **How this manual was produced.** Every procedure below was traced to the current source of the two repositories — the app's navigation graph, screens and English/Arabic text, and the console's routes, menus and permission catalogue. Where the code does not settle a question (for example a value the client has not yet agreed, or a screen that could not be exercised without a live account), the manual says so instead of guessing. Appendix C lists those items in full.

#### Conventions used

| Convention | Meaning |
|---|---|
| **Bold** | A control, screen, tab or field label as it appears in the product, e.g. **Sign in**, **Pickup Order**, **Verify & approve**. |
| `Monospace` | A technical identifier — status code, collection name, route. |
| 1. 2. 3. | Actions to perform in order. |
| > Note / Caution | Something that changes the outcome, or that staff must not do. |
| Rider app | The Android application on the rider's phone. |
| Console | The Admin console in a browser. |

#### Assumed baseline

The manual assumes the reader has an approved MG-GO account and a working internet connection. It does **not** assume the reader has any technical background: concepts such as “zone”, “project” and “DPD” are defined in the glossary (Appendix D).

## Part I — Before you begin

### 1. What the product does

MG-GO wraps the paperwork and the audit trail around food delivery work. Orders are still fulfilled in the client's own delivery partner apps; MG-GO records what happened, proves it, prices it and files the HR consequences.

| The rider app is responsible for | The console is responsible for |
|---|---|
| Signing the rider in and confirming it is really them | Creating the employee, approving them and issuing a passcode |
| Duty status and location while on duty | Publishing the shift schedule and alerting on lateness |
| Recording each pickup and each delivery or cancellation, with photos and GPS | Verifying the deliveries and reviewing exceptions |
| Showing earnings, incentives and payslips | Calculating pay, incentives and payroll |
| Assigned vehicle, fuel log, accident reports, assets | Fleet records, fuel limits, service schedule, accident cases |
| HR requests, visit bookings and documents to sign | The request inbox, visit slots and the e-signature workflow |
| Message inbox | Campaigns, audiences and notification templates |

### 2. Who uses what

| Role | Surface | What they can do |
|---|---|---|
| **Rider / driver** | Rider app | Everything in Part II. Sees only their own data. |
| **Operations staff** | Console | Employees, live tracking, deliveries, shift attendance, requests, visits, notifications, fleet. What appears depends on the permissions their role grants. |
| **Payroll / HR staff** | Console | Payroll tabs, earnings, payouts, e-signature, employees. |
| **Super administrator** | Console | Everything, including staff roles, permissions and settings. |
| **Client / partner user** | Console | A read-only, project-scoped view of their own riders and documents. |

> Note: the console hides a menu entry when the signed-in person's role does not include the matching permission. A chapter that “is missing” is almost always a permission question, not a missing feature. See Chapter 18.

### 3. Prerequisites — what must exist before a rider can use the app

A rider cannot sign in until five things are true. If any one is missing, the app refuses at the point noted.

| # | Prerequisite | Set up where | If it is missing |
|---|---|---|---|
| 1 | A phone running Android, with the app installed from **Google Play** | Play Store | The app is not sideloaded; the build must come from the store listing. |
| 2 | An employee record with an **MG ID** (Employee ID) | Console → Employees → **Add employee**, **Bulk import**, or EmployeeDesk intake | Sign-in reports invalid credentials. |
| 3 | The record **approved and active**, with a **6-digit app passcode** | Console → employee record → **Verify & approve** | Sign-in is refused as not active, suspended or archived. |
| 4 | A **zone or restaurant assignment** (unless the rider's section is non-operational) | Console → employee record → Private Information | Clock-in reports that no restaurant or zone is assigned. |
| 5 | A **shift** for today — submitted by the rider, or published by the office | Rider app, or Console → OperationsHub → Shift attendance → **Upload weekly schedule** | Duty stays blocked with “Submit shift to go In”. |

Two further prerequisites are physical rather than administrative: **location services must be on** while on duty, and the phone must not have **Developer options** enabled — a release build of the app refuses to run in that state (Chapter 15).

### 4. Installing and opening the app for the first time

1. Open **Google Play** on the phone and search for **Musallam Delivery**, or open the link the office provides. Do not install an APK file sent through chat.
2. Install and open the app.
3. The launch screen shows the client's splash image and logo. Both are set by the office in **Settings → Driver App**, so they can change without an app update.
4. If the app opens on **Update required**, the installed build is older than the minimum the office has published. Tap **Update on Play Store** and install the update. This gate applies before sign-in and cannot be skipped.
5. If the app opens on a full-screen maintenance notice, the office has paused the app for everyone. Read the message shown and try again later; there is nothing to fix on the phone.
6. At first launch the app requests the permissions it needs. Location, camera and notifications are each requested when a feature first needs them rather than all at once. Grant them — a refusal blocks only the feature that needs it (no location, no duty).

> Caution: if a phone previously carried a manually installed (non-Play) build signed with a different certificate, Play cannot upgrade it in place. The rider must uninstall the old app once, then install from Play.

## Part II — The rider app

### 5. Signing in

#### 5.1 Credentials

Sign-in uses two values, both issued by the office:

- **Employee ID** — the rider's MG ID. Letters and digits, not case-sensitive.
- **Passcode** — a **6-digit** number generated by the console the moment the employee is approved. It is shown to the office on the employee record and is never sent to the rider by the app.

1. Open the app. After the splash screen the **Sign in** screen appears.
2. Enter the **Employee ID** and the **6-digit passcode**.
3. Tap **Sign in**.

> Note: the passcode is a credential, not a password the rider chooses. If it is lost, the office reveals or regenerates it on the employee record; regenerating invalidates the old one immediately.

#### 5.2 Identity verification (face check)

The app confirms the person holding the phone is the account holder. On the first sign-in of the day the app opens **Verify identity**:

1. Hold the phone at face level, inside the frame.
2. **Blink once** when prompted. A still photo of a printed picture will not pass.
3. Tap **Confirm photo** to save, or **Retake** to start again.

The check is daily. It is not repeated each time the app is brought back to the foreground on the same day, and the office can exempt an individual rider (or the whole fleet) from it in **Settings → Driver App → Login photo verification**. If the camera is blocked, the app says so and the rider must allow camera access to continue.

#### 5.3 When sign-in is refused

The app distinguishes the reasons, and each one has a different remedy. Riders should read the message rather than retrying.

| What the rider sees | What it means | What to do |
|---|---|---|
| Invalid ID or passcode | The pair did not match any active record | Check the MG ID and the six digits. If both are right, the office should reveal the current passcode. |
| Account not active / suspended | The employee record is not in an active state | Contact the office. Suspended accounts are reactivated by operations, not by the rider. |
| Account archived | The employee record was archived | Contact the office. An archived record cannot be used at all. |
| Account blocked, with a reason | Operations blocked the account, or a freeze window is active | The message prints the reason, and the end date when it is a freeze. Wait or contact the office. |
| **Update required** | The installed build is below the minimum version the office set | Tap **Update on Play Store**. This is checked before the credentials are even verified. |
| **Already signed in elsewhere** | The account is active on another phone (one device per rider) | See 5.4. |

#### 5.4 One device at a time

Each rider account is bound to a single phone. If the rider signs in on a new phone while the old one still holds the session, the app shows **Already signed in elsewhere** with the other device's model and when it was last seen.

- **Continue on other device** — leave the other phone signed in; this one returns to the sign-in screen.
- **Sign in here** — take the session over. The other phone is signed out the next time it contacts the server.

Staff can also release a stale session from the console: **Settings → Driver devices** (the **Devices** tab on the employee record shows the same information).

#### 5.5 Signing out

**Profile** (last tab) → **Sign out** → confirm. Signing out ends the duty session and releases the device binding, so the next sign-in can be on any phone. Do not sign out while on duty unless the shift is over: the location stream stops and the rider shows as offline.

### 6. Getting around

The app has five permanent tabs across the bottom, plus one floating action button.

| Tab | What it is for |
|---|---|
| **Home** | Duty switch, today's numbers, incentives, rules and messages. |
| **Deliveries** | Calendar of past days and the list of that day's deliveries, with the pending-sync queue. |
| **Earnings** | Daily and period earnings, incentives, payslips and the pay calculator. |
| **Vehicle** | The assigned bike or car, its documents, service history, fuel log, assets and accident reporting. |
| **Profile** | Personal details, attendance, wrong actions, order exceptions, level, payments, terms, training videos, language, support and sign-out. |

The round **Add delivery** button floats above the tab bar on every tab and is the shortcut into **Pickup Order**. It is only usable while the rider is on duty.

Three global elements sit above the tabs:

- **Offline banner** — a strip appears whenever the phone has no connection. The app keeps working: entries are stored on the phone and sync when the connection returns (Chapter 16).
- **Notification badge** — the count of unread messages, visible on Home and in **Profile**.
- **Language** — the whole app is bilingual. **Profile → Language** switches between **English** and **Arabic**; Arabic flips the layout to right-to-left.

### 7. Home

Home is the rider's dashboard. It is assembled from the office's live configuration, so two riders may not see exactly the same cards — a card appears only when the corresponding rule, assignment or message exists.

#### 7.1 The header

- **Welcome back**, with the rider's name and picture.
- **Online / Offline** — the duty switch. **Online** means on duty; **Offline** means off duty. Chapter 8 covers the prerequisites for going online.
- **SOS** — present but disabled, labelled *coming soon*. Riders must call the office's published emergency number in an emergency.

#### 7.2 Today's activity

| Card | What it shows |
|---|---|
| **Time in today** | The hours accumulated since the first clock-in of the Kuwait day. |
| **Distance today** | The distance the app measured while on duty, from GPS. |
| **Current speed** | A live speed reading used to reassure the rider the location stream is working. |
| **Shift adherence** | Whether the rider clocked in on time against the published shift, shown as *On time*, *n min late* or *n min early*. |
| **Current shift** | The shift window the rider is inside right now, if the office published one. |

#### 7.3 Rules and targets

| Card | What it shows | Where the office sets it |
|---|---|---|
| **Delivery rules** | The pickup restaurant (or *any assigned restaurant*), the minimum distance from pickup for an accepted drop, the zone the rider must stay in, and the daily DPD target. | Console → Delivery rules, and Settings → Driver App → Delivery integrity |
| **Daily DPD target** | How many verified deliveries are needed today, how many are done, and how many remain. | Console → Delivery rules |
| **Incentive quests** | Live bonus offers: what unlocks them, the per-delivery rate above target, and what has already been earned. | Console → Incentive rules |
| **Weekly Bumper Bonus** | Progress towards the weekly bonus, with the number of deliveries still needed to unlock it. | Console → Incentive rules |

#### 7.4 Money and messages

- **Cash stack / earnings tile** — the earnings currently booked to the rider for the visible period, in KWD. Tapping it opens **Earnings**.
- **This week's progress** — a compact block with online time, deliveries, cancelled orders, rejected orders and the earnings figure for the week.
- **Important notifications** — the most recent messages, newest first, with **Mark all read** and **View all**. Tapping a message opens its detail.

#### 7.5 Location warnings

Two elements appear only when something is wrong, and both are actionable:

- **Zone status** — *In zone* in green, *Out of zone* in amber. A rider outside the assigned zone sees a banner asking them to return after the current delivery, or immediately when they are idle. Staying outside the delivery area for too long triggers the same rule the office enforces in live tracking.
- **Bonus action card** — the next thing to do, worded as **Start duty**, **Add delivery** or **Mark as delivered**, depending on state.

> Note: a card that reads “—” or is absent usually means the office has not published the underlying rule for that rider's project. It is not an app error.

### 8. Starting and ending duty

Duty is the switch that turns a phone into a tracked work session. Nothing about deliveries, distance or online time accrues while the rider is **Offline**.

#### 8.1 The shift must exist first

Before the **Online** switch will work, the rider needs a shift for today, from either source:

- **Published by the office** — operations uploads the weekly schedule in Console → OperationsHub → Shift attendance. On a roster day the rider sees the shift and does not submit one.
- **Submitted by the rider** — the app opens **Shift** when no roster row exists. Choose the shift type, the start and end time (a split shift uses two windows), confirm availability, and submit.

If the rider tries to go online without a shift, the button is refused with *Submit shift to go In*. A roster day shows *Today's shift is locked until it ends*, which means the office's schedule wins and the rider cannot change it.

#### 8.2 Going on duty

1. Tap **Online** in the Home header.
2. The app checks location first and shows **Checking your location…**.
3. If the rider is in the right place, the app asks for the check-in photo — a **front-camera selfie** taken at the counter, not a gallery image.
4. The duty write is sent. On success the header reads **Online** and the timer and location stream start.

What counts as “the right place” depends on how the rider is assigned:

| Assignment | The gate |
|---|---|
| Assigned to a **restaurant** | The rider must be within the office's configured distance of one of their assigned restaurants. The message names the nearest one and how far away it is. |
| **Keeta** project | The rider must be inside their assigned **zone** boundary. The message names the zone. |
| **Non-operational** section (office-based riders) | No place gate; the selfie and location fix still apply. |

If the office has switched off the check-in photo for that rider (or for everyone), step 3 is skipped and the app goes straight to the duty write.

#### 8.3 While on duty

Going on duty starts a live position stream that the office sees in **Live tracking V2**. The app manages this without supervision, but riders should know four rules:

1. **Location must stay on.** Turning location off, or revoking permission, ends the session. The app opens its settings gate when it cannot get a fix.
2. **The app stays in the foreground.** Pressing back while online moves the app to the background instead of closing it.
3. **Fake location is refused.** If the phone reports a mock or simulated position, sensitive actions are blocked and the attempt is recorded.
4. **Developer options must be off.** A release build refuses to run with Android Developer options enabled; the app explains this and offers to open the settings screen.

The app also monitors the rider's position against the assigned zone while they work, and raises the *out of zone* warning described in 7.5.

#### 8.4 Going off duty

1. Tap **Offline** in the Home header.
2. The app ends the session, closes the location stream and stamps the clock-out.

Two things end duty without the rider asking: reaching the end of a published shift window (the app clocks the rider out when the shift ends), and signing out. Both are recorded, and an automatic checkout after the shift ends still counts the worked time correctly.

#### 8.5 Why going online can be refused

| Message | Cause | Remedy |
|---|---|---|
| Submit shift to go In | No shift for today | Submit a shift, or ask the office to publish the roster. |
| You are *nnn* m from *restaurant* | Outside the check-in radius | Move to the restaurant and retry. |
| You are outside *zone* | Keeta rider outside the zone polygon | Enter the zone and retry. |
| No restaurant is assigned to you yet | Missing assignment | Office fixes the restaurant or zone assignment on the employee record. |
| Turn on location to check in | Location off or no fix | Enable location and retry. |
| A proof photo is required / camera unavailable | Camera permission refused | Grant camera access, then retake. |

### 9. Recording a delivery

A delivery is recorded in two stages, because the rider is at two different places at two different times. The app keeps them separate so the office can measure the gap between them.

```
Pickup Order  →  Active delivery  →  Finish as delivered  |  Finish as cancelled
(at restaurant)                     (at the customer)
```

#### 9.1 Stage 1 — Pickup Order

Start from the **Add delivery** button, from the **Deliveries** tab, or from the **Add delivery** card on Home.

| Field | Required | Notes |
|---|---|---|
| **Order ID** | Yes | The order number from the delivery partner app. Numeric in practice; the app refuses an empty value. |
| **Pickup proof** | No | A photo of the receipt or the order bag. Attaching one is recommended — it is the evidence used if the order is later disputed. |
| **Location** | Yes | Captured automatically at submit. If the phone has no fix, the app refuses and asks the rider to enable location. |

Two guards run before the record is written:

1. **Proximity.** The rider must be within the office's configured distance of the assigned zone or one of their assigned restaurants (the **Allowed distance** setting). Outside it, the pickup is refused and the rider is told how far away they are.
2. **One order at a time.** If an order is already open, the app names it and asks the rider to finish or cancel it first.

On success the app shows **Pickup logged successfully** and moves the rider to the active delivery.

#### 9.2 Stage 2 — Active delivery

The **Active delivery** screen is the order's home until it is closed. It shows the order number, the partner, and the pickup time, with two actions:

- **Mark as delivered**
- **Cancel order**

Leaving this screen does not lose the order: the **Add delivery** button returns to it, and Home reports the open order.

#### 9.3 Finishing as delivered

1. Open **Mark as delivered**.
2. Optionally attach a **delivery proof** photo (for example the handover). This is optional for a completed delivery.
3. If a photo is attached, the app reads the order number printed on it on the phone itself and compares it with the order ID that was entered. A mismatch is either blocked or warned, depending on the office's **Order photo OCR check** setting:
   - **Block mismatches** — a mismatch is refused; the rider either rescans or states a reason to continue.
   - **Warn only** — the rider is shown the mismatch and can continue.
   - **Off** — no check.
4. Confirm. The app records the location, and the delivery is completed.

#### 9.4 Finishing as cancelled

A cancellation needs more evidence than a completion, because a cancelled order is a commercial loss for the client.

1. Open **Cancel order**.
2. Choose a **cancel reason** — required. The list is fixed by the product, see 9.5.
3. Attach **cancel proof** — **required**. Without at least one photo the app refuses with *A proof photo is required*.
4. Add a note if the reason needs explaining, then confirm.

#### 9.5 Cancel reasons

The reason list is deliberately specific so that the office can see patterns rather than reading free text.

| Group | Reasons |
|---|---|
| Restaurant side | Item unavailable / insufficient dishes · Restaurant canceled the order · Long preparation time · Food theft (taken or misplaced inside the restaurant) · Merchant is closed · Restaurant issue · Food size too large for delivery |
| Customer side | Customer canceled the order · Customer no-show · Customer refused · Wrong address |
| Rider and logistics | Highway order · Automatic order acceptance not confirmed · Navigation/map issues · Delivery delayed · Order reassigned (late arrival at restaurant) · Vehicle breakdown · Accident |
| Other | Other |

#### 9.6 After the record is saved

- **Success screen.** A completed pickup offers **Proceed to deliver when ready**; a completed delivery or cancellation offers **Back to deliveries**. Both state whether the record was synced or saved for later.
- **Verification.** A delivery is *pending* until the office verifies it. Only verified deliveries count towards targets, incentives and pay — Home says as much under the verified count.
- **Flags.** A delivery completed very close to the pickup point can be flagged as an **early drop** by the office's threshold, and one completed far from the customer as a distance issue. Flags are review items for the office, not automatic penalties; they appear in the rider's **Order exceptions** only if a case is filed.

#### 9.7 The Deliveries tab

- A **calendar** shows how many verified deliveries were recorded on each day.
- Tapping a day lists that day's deliveries with their status. The list is bucketed by the **Kuwait shift day**, not by the phone's time zone, so a shift that runs past midnight still appears under the day it belongs to.
- If the phone is offline the tab shows the last cached list and says so, rather than an empty screen.
- **Pending deliveries** — the records still waiting to reach the server — are reachable from the same tab and from the offline banner.

### 10. Earnings

**Earnings** is read-only: it reports what the console has calculated. Nothing on this screen can be edited by the rider.

#### 10.1 What the screen contains

| Section | Meaning |
|---|---|
| **Daily earnings** | Day-by-day earnings for the current period, with a drill-down. |
| **Breakdown** | How the figure was built: base pay, bonuses applied, incentives, adjustments, deductions. |
| **Incentives** | Which incentive rules paid, and on which scope (rider, restaurant, zone or client project). |
| **Payslips / payout detail** | The approved payout periods, with the deliveries inside each period, the deduction lines (including loan instalments) and the net payable. |
| **Extra earnings** | The live offers the rider can still reach: target, verified count so far, the rate above target and the bonus earned so far. |

> Note: earnings are calculated from **verified** deliveries only. A delivery that is still pending, rejected or cancelled does not pay, which is why the count on Home and the count in Earnings can differ during the day.

#### 10.2 Pay calculator

**Pay calculator** estimates the month's pay from figures the rider enters — orders, rejected orders, cancelled orders, active days — using the rider's own active pay band. It is an estimator for planning, not a statement: the real figure always comes from the payroll calculation.

#### 10.3 When a figure looks wrong

Earnings follow the rules the office published, so a low figure is usually one of four things: unverified deliveries, a rule that does not apply to the rider's project, a cancellation, or a deduction (for example a loan instalment). The rider should raise a **Salary justification** request (13.3) with the date and the order IDs rather than waiting for payroll.

### 11. Vehicle

The **Vehicle** tab shows the bike or car the office assigned. If nothing is assigned the tab says so and no other action is possible until the office assigns one.

#### 11.1 Vehicle details

Plate, model, type (bike or car), chassis, year, condition, fuel type, fuel card or chip number, monthly fuel limit and status. These are maintained by the office; the rider reads them.

#### 11.2 The vehicle's other panels

| Panel | Contents |
|---|---|
| **Documents** | Registration, health card and Baladiya card, with expiry dates. A document nearing expiry is the rider's cue to visit the office. |
| **Service** | The maintenance records filed against the vehicle, including the odometer at each service. |
| **Handover** | Handover records between riders. |
| **Assets** | Items issued with the vehicle — phone holder, bag, uniform and similar. |
| **Accident** | Accident reports filed by this rider (see 11.4). |

#### 11.3 Fuel log

1. Open **Log fuel** on the Vehicle tab.
2. Enter the **station**, the **litres**, the **cost in KWD** and the odometer reading.
3. Attach the three required photos: **fuel pump**, **odometer** and **receipt**. At least one photo is mandatory; the app names any that are missing.
4. Submit. The entry goes to the office for approval.

A monthly fuel limit is configured per vehicle by the office and shown on this tab. The app displays the limit and the amount used; whether a fill above the limit is blocked or simply flagged is an office policy decision that is **not** enforced in the app code reviewed for this manual (Appendix C).

#### 11.4 Reporting an accident

Report an accident as soon as it is safe to do so — the report is the record the fleet desk works from.

1. Open **Report an accident** on the Vehicle tab.
2. **When it happened** — today by default; a past date can be chosen, a future date is refused.
3. **Where it happened** — the app reads the location and lets the rider add a description.
4. **Other party** — name, plate and phone, if there is another party. All optional, but they make the case workable.
5. **What happened** — the rider's own description.
6. **Attach evidence** — photos and video. The screen states the file limit and the maximum size per file; files upload when the report is submitted, not before.
7. Submit. The app returns a reference in the form *Accident {reference} reported*.

The **Accident** panel then lists the rider's own reports with their case state: **Pending** (the desk is working on it), **Delay** (waiting on something — usually a document) and **Close** (settled). An *Uploaded* marker shows that the evidence reached the server.

### 12. Profile and personal records

The **Profile** tab is the rider's own file plus the entry point to support.

| Item | What it opens | Notes |
|---|---|---|
| **My profile** | Personal information: name, Employee ID, mobile, nationality | Read-only. Changes are made by the office; the screen says so. |
| **Attendance & Leaves** | The attendance record for the period, with *present / elapsed days* | Read-only. |
| **Wrong Action** | Every wrong action filed against the rider, with type (delay, zone breach, hygiene failed, uniform, other), severity (low, medium, high) and date | Read-only. Disputes go through Help & support. |
| **Order exceptions** | The rider's own rejected and cancelled order cases (see 12.1) | The rider creates these. |
| **Performance level** | The rider's level and the numbers behind it | Read-only. |
| **Payment details** | Bank and payment information on file | Read-only. |
| **Assets** | Items issued to the rider | Read-only. |
| **Terms & Conditions** | The current version of the rider terms | Read-only. |
| **Tutorial material** | The training video the office has published | Needs a connection to stream. |
| **User manual video** | The client's how-to video | Same. |
| **Language** | English / Arabic | Applies immediately across the app. |
| **Notifications** | The message inbox | See Chapter 14. |
| **Help & support** | The support hub | See Chapter 13. |
| **Sign out** | Ends the session | See 5.5. |

#### 12.1 Order exceptions — filing a case

When an order is rejected in the partner app or cancelled in a way that affects the rider's record, the rider can file a case so the office can restore the order to their count.

1. **Profile → Order exceptions →** new case.
2. Choose the kind: **Rejected** or **Cancelled**.
3. Choose who caused it: **I declined it** or **Store or customer**.
4. Enter the **Order ID** (digits, 1–32) and a **reason** of at least 8 characters.
5. Attach **at least one photo** — up to five. This is the evidence.
6. Submit. The case shows as **Under review** until the office decides it: **Approved** (the order is credited), **Rejected**, or approved with a review note.

#### 12.2 Performance level

The level screen explains the standard the rider is measured against and, where the rider is below it, the gap: *required orders*, *verified*, *gap*, *active days*. A rider inside the standard sees *You are on target*. The level is recalculated by the office from verified deliveries — nothing here is edited on the phone.

### 13. Help & support

**Profile → Help & support** is a single hub with three sections: **Raise a request**, **Visit us** and **Your activity**.

#### 13.1 The hub

| Tile | Purpose |
|---|---|
| **Leave** | Request annual leave for a date range. |
| **Sick & accident leave** | Report sick leave or an accident-related absence, with evidence. |
| **Asset request** | Ask for an item (uniform, bag, phone holder, …). |
| **Fuel reimbursement / Fuel refund** | Claim fuel money back, with receipts. |
| **Document request** | Ask the office to issue or re-issue a document. |
| **Complaint** | Raise a complaint about a restaurant, a customer or a working condition. |
| **Salary justification** | Question or explain a pay figure. |
| **Loan request** | Apply for an advance or loan, with a repayment period. |
| **Schedule a visit to Central Tower** | Book a slot at the office (13.4). |
| **My requests** | Everything the rider has sent, plus anything the office addressed to them. |
| **My visits** | Upcoming and past visit bookings. |
| **Documents to sign** | Documents waiting for the rider's signature (13.5). |
| **Action required** | Items where the office is blocked waiting for the rider. |
| **Appointments** | Confirmed appointments with their time and place. |

A badge on the hub counts the items that need the rider's attention, so a rider who ignores the screen still sees the number.

#### 13.2 Raising a request

1. Choose the tile. The form is built per request type, so the fields match the request — a leave request asks for dates, a loan request for an amount and a repayment period, a fuel claim for receipts.
2. Complete the fields. Required fields are marked; the app refuses an incomplete form and names the field.
3. Attach the evidence the tile asks for. Some tiles require an attachment (for example a fuel receipt or a signed acknowledgement); others accept one optionally.
4. Submit. The app confirms with **Request submitted**.

Dates are validated before sending: an end date cannot precede a start date, and a “needed by” date cannot be in the past.

#### 13.3 Following a request

**My requests** has two groups — **Request sent** and **Request received** — with a badge whenever the rider owes an answer.

| Status | Meaning |
|---|---|
| **Awaiting ack** | Sent; the rider has not acknowledged it yet. |
| **Acknowledged** | Seen and accepted by the office. |
| **In progress** | Being handled. |
| **Solved** | Closed in the rider's favour, or closed as answered. |
| **Overdue** | Past the office's response target. |

Inside a request the rider sees the office's steps and can act:

- **Acknowledge** a request the office created on their behalf (for example a penalty or a document requirement).
- **Your response** — reply to a clarification request. The office can hold a request until this arrives.
- **Add attachment** — supply a document the office asked for.
- **Ask a question** — add a comment to the thread.
- **Accept / decline a reschedule** — when the office proposes new dates (for example on a leave request), the proposal shows both the original and the new dates.

#### 13.4 Booking a visit to Central Tower

Visits are appointment slots at the office. They exist so a rider does not travel and wait.

1. **Help & support → Schedule a visit to Central Tower → Book a slot.**
2. Choose the **department** the rider needs to see.
3. Choose the **date**, then a **time** slot. Slots are grouped into **morning** and **afternoon**, with a lunch break between them. A full slot is marked **Full**; a partly used one shows how many places remain.
4. Give the **visit reason** and, optionally, a note.
5. Review and confirm. The app issues a booking with a **ticket** headed *Central Tower Visit* and a token to show at reception.

**My visits** lists **Upcoming** and **Past**. An upcoming visit can be **rescheduled** (choose another slot) or **cancelled** before it starts. The office keeps the same record on its side, so a rider who books on the phone appears in the reception queue.

#### 13.5 Signing a document

Documents that need the rider's legal signature arrive in **Documents to sign**. Typical items are a loan agreement, a payslip acknowledgement, an accident declaration or a policy acknowledgement.

1. Open **Documents to sign**. Documents are grouped as **Pending**, **Signed**, **Awaiting counter-signature**, **Declined** and **Expired**; filters narrow the list to *not opened* or *opened*.
2. Open the document. The viewer shows the full sheet the office generated, including the rider's own data.
3. Tap **Add your signature** and draw the signature with a finger. **Clear** starts again; an empty signature is refused.
4. Optionally attach the documents the request asks for — the screen states the attachment limit.
5. Tick the declaration **I agree this is my legal electronic signature.**
6. Tap **Confirm signature**. The document moves to **Signed** (or **Awaiting counter-signature** while a manager still has to sign), and the rider can download their copy.

A declined or expired document cannot be signed; the rider must ask the office to reissue it.

#### 13.6 Appointments

**Appointments** lists confirmed meetings with the office — time, place and subject, with a confirmation screen when a booking is made. An empty list reads *None scheduled*.

### 14. Notifications

Messages arrive as push notifications and are kept in the inbox at **Profile → Notifications** and in the **Important notifications** card on Home.

- Unread items are counted on the badge.
- **Mark all read** clears the count without deleting anything.
- **Clear all notifications** empties the inbox, after a confirmation — the messages are not recoverable from the phone afterwards.
- A message links to the screen it is about where one exists (a request, a document, a visit).

Notifications are the office's channel for shift changes, document expiries, request outcomes and campaigns. A rider who has notifications switched off at the Android level still sees the inbox, but not the pop-up.

### 15. Safety, security and compliance

These rules are built into the app rather than left to supervision.

| Control | Behaviour | Why |
|---|---|---|
| **Screen capture block** | Screenshots and screen recording are blocked while signed in, and attempts are recorded where Android allows it | Protects personal and payroll data |
| **Developer options block** | A release build refuses to run with Android Developer options on | Prevents mock locations and tampering |
| **Mock location block** | A simulated position blocks location-based actions | Protects delivery and attendance evidence |
| **One device per rider** | A second phone must take the session over explicitly | Prevents passcode sharing |
| **Daily identity photo** | A blink-then-photo check on the first sign-in of the day | Confirms the account holder is the rider |
| **Check-in photo** | A front-camera selfie inside the restaurant range, when enabled | Proves the rider was on site at clock-in |
| **Location while on duty** | Position is reported only between clock-in and clock-out | The office can follow deliveries without tracking riders off duty |
| **On-duty foreground** | The app stays resident while online | Keeps the location stream alive |

Riders should be told plainly: **do not share the passcode, do not disable location, and do not use fake-location tools.** Each of those is detected and recorded against the account.

### 16. Working offline, and when something goes wrong

#### 16.1 Offline behaviour

Riders work in basements, lifts and dead spots, so the app is built to keep recording.

- An **offline banner** appears at the top of every screen when the connection drops.
- A delivery or cancellation submitted offline is stored on the phone and the confirmation says **Delivery saved offline** / *This entry will sync automatically when internet returns*.
- **Pending deliveries** shows the queue and how many records are waiting. Syncing happens automatically when the connection returns; the app also retries when it is brought back to the foreground.
- Lists (deliveries, earnings) show the last cached copy and label it as cached instead of pretending the data is current.

> Caution: a queued record is not yet counted. Until it syncs it does not appear in the office's verification queue and does not pay. A rider who sees a growing pending count should find a signal and keep the app open until it clears.

#### 16.2 Troubleshooting — rider side

| Symptom | Most likely cause | What the rider should do |
|---|---|---|
| “Invalid ID or passcode” | Wrong MG ID, or the passcode was regenerated | Ask the office to reveal the current passcode. |
| Sign-in refused as suspended or archived | Account state changed | Contact the office; only they can reverse it. |
| “Update required” loop | Play Store has not offered the update yet | Pull-to-refresh in Play, or uninstall and reinstall from the listing. |
| Cannot go **Online** | No shift, location off, outside range or zone, camera permission | See 8.5; the message names the cause. |
| Location keeps dropping | Battery optimisation is closing the app | Allow the app to run in the background / disable battery optimisation for Musallam Delivery. |
| Pickup refused | Outside the restaurant proximity radius, or an order is already open | Move closer, or close the open order first. |
| “A proof photo is required” on cancel | No cancel photo attached | Attach at least one photo. |
| Delivery not counted | Still pending, rejected, or cancelled | Check the delivery status; file an **Order exception** if it was wrongly rejected. |
| Earnings lower than expected | Unverified deliveries, a rule not applicable to the project, or a deduction | Raise a **Salary justification** request with dates and order IDs. |
| Fuel log rejected | A required photo is missing | Re-submit with pump, odometer and receipt photos. |
| Document cannot be signed | It expired or was declined | Ask the office to reissue it. |
| Visit slot shows **Full** | Slot capacity reached | Pick another time or department. |

### 17. Common tasks — quick reference

| I want to… | Go to |
|---|---|
| Start my shift | Home → **Online** (after submitting the shift if the office did not publish one) |
| Record a pickup | **Add delivery** → enter Order ID → **Confirm pickup** |
| Close a delivery | **Active delivery** → **Mark as delivered** |
| Cancel an order with evidence | **Active delivery** → **Cancel order** → reason + photo |
| See what I earned today | **Earnings** → **Daily earnings** |
| Check a bonus I am close to | **Earnings** → **Extra earnings** |
| Estimate my monthly pay | **Earnings** → **Pay calculator** |
| Log fuel | **Vehicle** → **Log fuel** |
| Report an accident | **Vehicle** → **Report an accident** |
| Ask for leave | **Profile → Help & support → Leave** |
| Dispute a rejected order | **Profile → Order exceptions** → new case |
| Book an office visit | **Profile → Help & support → Schedule a visit** |
| Sign a document | **Profile → Help & support → Documents to sign** |
| Read a message | **Profile → Notifications** |
| Change the language | **Profile → Language** |
| See my vehicle documents | **Vehicle** → **Documents** |

## Part III — The administration console

The console is the office's side of the same product. This part is written for staff: it covers what each area is for, the sequence of actions that matter, and — where relevant — the effect the action has in the rider app. It is a working companion, not an exhaustive screen-by-screen reference.

### 18. Access, navigation and permissions

#### 18.1 Signing in

1. Open `https://dpdadmin-prod.vercel.app` in a current browser.
2. Sign in with the staff email address and password issued by the super administrator.
3. The first screen is the **Apps** launcher; the left rail lists the modules your role can open.
4. Switch between English and Arabic from the account area; the whole console is bilingual and Arabic runs right-to-left.

Staff accounts cannot be used in the rider app, and rider accounts cannot be used in the console.

#### 18.2 How the console is organised

The left rail groups modules. Each entry is a module; a module with sub-pages expands when opened.

| Group | Modules |
|---|---|
| **Overview** | Apps (launcher) |
| **Operations** | Employees · Rider Operations V2 · Client Portal V2 · Live tracking · Live tracking V2 · Live Deliveries · Order reconciliation · DPD Verification · Performance · Payroll · Payouts · Notifications · Wrong Actions |
| **OperationsHub** | Driver groups · Partners · Restaurants · Zones · Order reconciliation · Shift attendance · Performance · Order exceptions · Earnings · Delivery rules · Incentive rules · Attendance settings · Driver fields · Employee statuses · Employee sections · Nationality Category |
| **EmployeeDesk** | All requests · Incoming · Outgoing · E-Signature · Visit bookings · Reports · Settings |
| **Fleet** | Fleet Hub · Fuel Log · Fuel Request · Fuel Refund · Assets · Asset requests · Service · Handover · Accident · RJ · Vehicle types/uses/companies · Service types |
| **Visit Bookings** | Visit Slots (hub, all visits, calendar, reception, slots, reports) |
| **Settings** | Branding · Driver App · Roles & Permissions · Staff access · Driver devices · Sponsorships · Companies · Bank codes · Support · Maintenance |
| **System** | Staff Assistant · Cloudflare R2 · Access Requests · Menu Editor · Languages · Data cleanup · Activity Logs |

> Note: a module appears only if your role holds its permission. If a colleague can open something you cannot, that is a permission difference, not a version difference.

#### 18.3 Four kinds of staff account

| Kind | What it means in practice |
|---|---|
| **Super administrator** | Every module, plus staff roles, permissions, settings and maintenance. |
| **Full access (manager)** | Every module the permission catalogue lists, which is effectively the whole product except the super-administrator-only settings. |
| **User** | Only the modules an administrator ticked for that person. This is the normal account for a team member with a defined job. |
| **Partner (client)** | Read-only, limited to one client project, with phone numbers hidden and no ability to change data. |

Roles are edited in **Settings → Roles & Permissions**: pick the person, choose the role, choose the access kind, and tick the modules. Access requests raised from the sign-in screen are approved in **System → Access Requests**.

### 19. Employees — the rider's master record

**Operations → Employees** is the list every other module reads from. Its first column is the **Client ID**; the **MG ID** is the Employee ID the rider types into the app.

#### 19.1 Creating a rider

Three routes exist, and all three end at the same record:

| Route | Use it when |
|---|---|
| **Add employee** | One rider, entered by hand. |
| **Bulk import** | A batch from a spreadsheet, with a preview, per-row errors and undo/redo. |
| **EmployeeDesk intake** | A hiring pack arrives from another department and needs review before it becomes an employee. |

On the record, complete the assignment before approving: **Zone**, **Restaurants**, **Vehicle**, **Vehicle type**, **Client ID**, **Platform**, **Project** and the private details (civil ID, passport, nationality, sponsorship, job, hiring date, employee status, bank). A rider in a non-operational section (for example office-based staff) needs no zone or restaurant.

#### 19.2 Approving and issuing the passcode

1. Open the employee record.
2. Confirm the identity documents are on file — the record shows how many of the six standard documents are present.
3. Tap **Verify & approve**. The console asks: *Create the driver account, activate them, and generate a 6-digit app passcode?*
4. Confirm. The console reports **Driver approved — passcode ready** and shows the passcode.

The passcode panel on the record then allows **Show**, **Copy** and **Regenerate**. Regenerating is immediate: the old passcode stops working at once, so only do it when the rider is expecting the new one. Until a rider is active, the panel reads that the passcode is generated automatically once the driver is set to active.

#### 19.3 The employee record

| Tab | Contents |
|---|---|
| **Private Information** | Identity, employee status, bank and salary sections, each collapsible. |
| **Documents** | The six standard identity documents plus extras, with expiry and download. |
| **Attendance** | The rider's attendance history and leave rows. |
| **Assets** | Items issued to the rider. |
| **Earnings** | The rider's earnings and incentive rows. |
| **Loan** | Loan balance, instalments and status. |
| **History** | Every change made to the record, with who made it. |
| **Location** | Last known positions. |
| **Activity** | What the rider has done in the app. |
| **Login Verification Details** | The daily identity photos, with the per-driver exemption switch. |
| **Devices** | Phones the rider has signed in on, with **Force update once** and session release. |

#### 19.4 Account states and the login block

The rider's ability to sign in is decided by these controls on the record:

| Control | Effect |
|---|---|
| **Account status** | Only **active** riders can sign in. Inactive reads as “not active”; suspended reads as suspended. |
| **Block** (with a reason) | Sign-in is refused and the reason is shown on the phone. |
| **Freeze** (from / until + reason) | Refused inside the window; the phone prints the reason and the end date. |
| **Archive** (reason required) | The record is hidden from the active list and cannot sign in at all. |
| **Force update once** | The next sign-in from that phone must be on a build at or above the number set. |
| **Login photo exemption** | Skips the daily blink-and-photo check for that rider. |

#### 19.5 Archiving and deleting

- **Archive driver** — requires a reason. The rider disappears from the active list and their passcode stops working. Archive is reversible from the same screen.
- **Delete employee** — permanent. It requires the *Bulk delete employees* permission, and the operator must type the MG ID back to confirm. It removes the record, the unfinished profile, the app login, files and the reservations they hold on the MG ID and phone number. Use archive first unless the record was created in error.

> Caution: deleting a record frees the MG ID and the mobile number for reuse. That is intended for records created by mistake, not for leavers whose history payroll may still need.

#### 19.6 Documents, compliance and expiry

- **Documents** on the record holds the identity pack; missing items are counted on the record header.
- **Operations → Compliance Upload** ingests bulk document packs and matches them to employees.
- **Operations → Document expiry** is the working list for renewals: it flags documents that are expired or about to expire so the office can chase them before they block a rider. The same expiries appear on the rider's **Vehicle → Documents** panel and, for personal documents, on the rider's profile.

#### 19.7 Driver devices

**Settings → Driver devices** lists every phone that has signed in, with the rider, the device, the app build and the last time it was seen. From here the office can:

- see which build a rider is really running (the app reports it, so an outdated phone is visible before it causes a support call);
- send **Force update once** to a specific device, which blocks that phone's next sign-in until it updates;
- release a session so a replacement phone can sign in without the rider having to find the old one.

### 20. Shifts, rosters and attendance

The rider app will not let anyone go on duty without a shift, and **Shift attendance** is where shifts are published.

#### 20.1 Setup

**OperationsHub → Shift attendance** is the setup screen. It holds:

| Setting | Meaning |
|---|---|
| **Late login grace** | Minutes after the shift start before a login counts as late. |
| **Early logout grace** | Minutes before the shift end that still count as on time. |
| **No-login grace** | Minutes after the shift start before “no login” becomes an alert. |
| **Early drop near restaurant** / **Early drop under** | The two thresholds that flag a delivery completed too near the pickup or too quickly. |
| **Far from customer** | The distance that flags a completion recorded far from the customer. |
| **Flag a missing pickup proof** | Whether a delivery with no pickup photo is flagged. |
| **Zone staff** | Which staff see which zones' riders in live tracking and alerts. |
| **Assign restaurants to zones** | The bulk mapping that lets restaurant-level data roll up to a zone. |

Save the thresholds once; they are read by the live map, the alerts sweep and the report.

#### 20.2 Publishing the weekly schedule

1. Open **Shift attendance → Upload weekly schedule**.
2. Download the **template** if needed. It contains a **Schedule** sheet and a **Guide** sheet; the example IDs in it must be replaced with real MG IDs before upload.
3. Fill one row per rider per day. Two rows for the same rider and date become a **split shift**. An **OFF** day is a row with no working hours.
4. Upload the file. The console previews every row as **Ready** or **Failed** (with the reason) before anything is written.
5. Apply. The roster days immediately lock the rider's own shift submission, and the rider's app shows the published shift.

Because the schedule drives clock-in, alerts and the attendance report, correct it at the source rather than editing individual riders afterwards.

#### 20.3 Schedule changes

**Shift attendance → Schedule changes** is the list of change requests plus a form to raise one. An **approved** change is the row the live map, the alerts and the report read. A pending or rejected change leaves the originally uploaded shift in place, so nothing silently shifts under the rider.

#### 20.4 Alerts

**Shift attendance → Alerts** lists the day's exceptions and lets the office acknowledge each one with an outcome:

- no login after the grace period,
- late login,
- early logout,
- early drop (near the restaurant, or under the minimum minutes),
- missing pickup proof,
- a completion recorded far from the customer.

Acknowledging is what closes the loop: the alert keeps its evidence, and the outcome records what the office decided.

#### 20.5 Report and export

**Shift attendance → Report** filters by date range, zone, restaurant, company and rider, and exports to Excel. It carries scheduled hours against worked hours, plus who approved any schedule change — which is the row to quote when a rider disputes their attendance.

### 21. The rules that shape the rider's screen

Three configuration areas decide what a rider sees and what they are paid. Getting them right removes most “the app is wrong” reports.

#### 21.1 Delivery rules

**OperationsHub → Delivery rules** defines the target a rider chases. A rule is scoped to a rider, a restaurant, a zone, a client project or a company, and carries:

- the **DPD target** (deliveries per day) and its period,
- the validity window (start and end date),
- the scope it applies to.

Rules reach the app as the **Delivery rules** and **Daily DPD target** cards on Home. The most specific scope wins, and a rule needs a positive target and a daily (or blank) period to be saved as active — the console refuses otherwise.

#### 21.2 Incentive rules

**OperationsHub → Incentive rules** defines the bonuses shown in **Extra earnings** and in the quest cards on Home: the tier or rate paid per delivery above a target, the scope, and the validity window. An incentive only pays on **verified** deliveries, so the app shows the offer as *pending verification* until the office verifies the day.

#### 21.3 Pay plan and earnings calculation

**Payroll → Pay plan** and **Operations → Earnings calculation** hold the pay bands and the rules that turn verified deliveries into money. **Earnings & Incentives** shows the resulting per-rider figures. The rider's **Pay calculator** uses the same band, so the two should agree within a few orders.

#### 21.4 Driver app settings

**Settings → Driver App** is the one screen that changes the rider's experience without a release. It contains:

| Section | What it controls |
|---|---|
| **Branding** | App title, logo, splash screen and app icon. |
| **Login photo verification** | Fleet-wide exempt switch for the daily blink-and-photo gate. |
| **Driver app maintenance** | The on/off switch and the message shown on every phone. Separate from the console's own maintenance mode. |
| **Delivery location check** | **Allowed distance** in metres — the radius used for pickup and check-in. `0` disables the check. |
| **Delivery integrity** | **Require check-in photo**, **Early drop threshold**, and **Order photo OCR check** (block / warn / off). |

Changes here are read by the app on its next refresh; they do not need a new build.

### 22. Fleet

#### 22.1 Vehicles

**Fleet → Fleet Hub** is the vehicle list and the place a rider's bike or car is maintained. Each vehicle carries its identity (plate, chassis, model, type, year), its assignment to a rider, its documents, its service records, its handover history and its accident cases.

The vehicle's plate and type are what the rider sees on the **Vehicle** tab, so a wrong assignment shows up on the phone within a refresh.

#### 22.2 Fuel

| Screen | Purpose |
|---|---|
| **Fuel Log** | Every fill recorded, with station, litres, cost and odometer. |
| **Fuel Request** | Fills that need approval or a top-up beyond the card limit. |
| **Fuel Refund** | Cash claims where the rider paid and wants the money back. |

Fills submitted from the rider app arrive here; the monthly limit on the vehicle is visible on the same row, which is how an unusual pattern is spotted.

#### 22.3 Assets

**Assets** is the inventory of items issued (bags, uniforms, phones, holders) and **Asset requests** is the queue of things riders have asked for. Approving a request is what makes it appear on the rider's **Assets** list.

#### 22.4 Service, handover, accidents and RJ

| Screen | Purpose |
|---|---|
| **Service** | Service records by vehicle and type, cost analysis, and the preventive maintenance schedule per programme (oil, front tyres, rear tyres, brakes, chain) with a separate bike page. |
| **Handover** | The record of a vehicle passing between riders, with condition. |
| **Accident** | Accident cases filed from the rider app, with evidence, and the desk's handling state (pending / delay / closed). |
| **RJ** | Replacement-job records for vehicles out of service. |

#### 22.5 Catalogs

**Vehicle types**, **Vehicle uses**, **Vehicle companies** and **Service types** are catalogs, not code. Adding a type or a company is a data change, and the rider app picks the new label up automatically — no release needed.

### 23. Requests and EmployeeDesk

Riders file HR and operational requests from **Help & support**. They arrive in two places.

#### 23.1 The request queue

**Operations → EmployeeDesk** lists every request with filters for type, status, project and date. Opening one shows the rider's form, the attachments, and the history of decisions.

The actions that move a request forward:

| Action | Effect on the rider's phone |
|---|---|
| **Acknowledge** | The status becomes *Acknowledged*; the rider sees that it was received. |
| **Ask for clarification** | The rider gets a badge, and the request waits for **Your response**. |
| **Propose new dates** | The rider sees both the original and the proposed dates and can accept or decline. |
| **Approve / reject with a reason** | The final status and the reason appear in **My requests**. |
| **Set loan terms** | For a loan or advance, the approved amount, instalments and deduction start become visible in the rider's request and their payslips. |

#### 23.2 EmployeeDesk workspace

| Screen | Purpose |
|---|---|
| **All requests / Incoming / Outgoing** | The queue, split by direction. *Outgoing* covers requests the office raised on the rider's behalf, which the rider must acknowledge. |
| **E-Signature** | The signature workspace (Chapter 25). |
| **Visit bookings** | The visit queue and reception (Chapter 24). |
| **Reports** | Volumes and turnaround by type, with export. |
| **Settings** | Request types, fields and the response targets used for *Overdue*. |

### 24. Visits — slots, calendar and reception

A visit booking is a rider's appointment at the office, booked from **Help & support → Schedule a visit to Central Tower**. The console side lives in **Visit Slots**.

#### 24.1 Setting up the diary

1. **Visit Slots → Slots** defines the weekday slots: the opening hours, the services offered (for example HR, documents, operations, complaints), the slot length and how many riders each slot holds.
2. **Branches** holds the locations and their working hours; **Departments** holds the list a rider chooses from.
3. Publish. From that moment the slots appear on the rider's booking screen with live capacity — a full slot reads **Full**, a partly used one shows how many places remain.

#### 24.2 The working views

| View | Use it for |
|---|---|
| **Manage** | The hub: today's counts, a quick route into each view. |
| **All visits** | The full list with column filters (rider, department, status, slot, date) and department tabs. |
| **Calendar** | Day view (services as rows, times as columns, with the current slot marked), week view (capacity bars per day), month view (a heat table with the busiest services) and year view (12 mini-months with peak identification). |
| **Reception** | The desk: the rider arrives with their ticket token, reception checks them in, and the visit moves to *Checked in* then *Completed*. |
| **Reports** | Volume, no-shows and utilisation by slot, service and branch. |

A rider who cancels or reschedules on the phone frees the place immediately, so reception and the calendar stay truthful.

### 25. E-signature

Documents that need a legal signature — loan agreements, payslip acknowledgements, accident declarations, policy acknowledgements — are produced, sent, signed and archived in **EmployeeDesk → E-Signature**.

#### 25.1 The document set

| Screen | Purpose |
|---|---|
| **Templates** | The document designs. A template is built in the **builder** from fields, sections and signature slots, and previewed on an A4 sheet. |
| **Send** | Create one request: choose the template, the rider, the dates, and edit any field values for that rider. |
| **Bulk / Batches** | Send the same document to many riders at once. Each batch is a container with its own list of recipients and its own progress. |
| **Sent** | Everything issued, with status per request. |
| **Signing** | The staff queue for documents that need a counter-signature (HR, GM, CEO depending on the document type). |
| **Waiting** | Requests blocked on the rider, or on a missing counter-signature. |

#### 25.2 The lifecycle of a document

1. **Drafted and sent** — the rider receives a push notification and the document appears in **Documents to sign**.
2. **Opened** — the app records that the rider opened it.
3. **Signed by the rider** — the rider draws a signature and accepts the declaration. If the request asked for attachments, they arrive with the signature.
4. **Counter-signed** — management signs in the **Signing** queue, inside the signature slot the template defines. A document is not final until the last required signature is in.
5. **Signed PDF** — the composed document with every signature is downloadable. If a staff signature is still outstanding, the download explains that it is awaiting counter-signature rather than failing silently.
6. **Declined / expired** — the rider declined, or the validity window closed. Either way the document is void and a new request must be raised.

Every step is stamped with who did it and when, which is what makes the archive usable in a dispute.

### 26. Notifications

**Operations → Notifications** sends messages to the rider app's inbox and as push notifications.

#### 26.1 Sending a campaign

1. **New notification**.
2. Write the **title** and **body**. Personalisation tokens are supported for imported recipient lists.
3. Choose the **audience**:
   - all live riders,
   - by **client project** (Keeta, Americana, Five Guys),
   - by **zone**,
   - by **status** (active, pending, suspended),
   - or an **imported list** of Employee IDs, driver codes or client IDs.
4. Preview the count. The console shows how many riders the audience resolves to **before** sending; a count of zero almost always means a filter that matches nothing.
5. Send now, or schedule.

#### 26.2 The other tabs

| Tab | Purpose |
|---|---|
| **Templates** | Reusable titles and bodies. |
| **Automations** | Rule-driven messages (for example a document expiring). |
| **Analytics** | Delivery, open and click numbers per campaign. |
| **History** | Every campaign with its audience, status and per-rider delivery list — the answer to “did this rider receive it?”. |

### 27. Live operations and quality control

#### 27.1 Live tracking V2

**Operations → Live tracking V2** is the full-bleed map of everyone on duty. It carries the rider pins, restaurant pins, and a rail of filters: restaurant, company and schedule status, plus duty chips for the counts.

Each rider card shows the scheduled window, the Kuwait login time, the grace period, flag badges (early drop, out of zone) and any approved schedule change. The insights rail lists zone distribution, today's alerts and the recent event feed. A rider whose phone has gone quiet fades out of the map rather than being shown in a misleading position.

Use it for the live question — *who is working, where, and who needs a call* — and use the report for anything that has to be defended later.

#### 27.2 Live Deliveries and verification

**Operations → Live Deliveries** is the delivery feed. Pending deliveries are verified here; verification is what converts a recorded delivery into earnings and into the counts the rider sees. The same screen surfaces outside-zone rows and the evidence attached to each delivery, so a verifier can accept or reject with the photo in view.

#### 27.3 Exceptions and conduct

| Screen | Purpose |
|---|---|
| **Order exceptions** | The rider's rejected/cancelled order cases. Approving one restores the order to the rider's count; rejecting one keeps it out. |
| **Wrong Actions** | The register of conduct issues, by type (delay, zone breach, hygiene, uniform, other) and severity. A row filed here appears in the rider's **Wrong Action** screen immediately. |
| **DPD Verification** | The per-rider daily target against verified output. |
| **Performance** | The SOP dashboards: orders, DPD, UTR, delivery time, rider/restaurant/zone analysis, with Excel export. |
| **Order reconciliation** | The monthly reconciliation of partner order files: import, compare, commit, and undo/redo a committed run. |

#### 27.4 Dashboards for management and clients

- **Rider Operations V2** — the workforce view: total riders, working, on leave, sick, absent, not marked, accidents, with a roster that opens from any card, hiring and contract-end outlook, and a leave planner.
- **Client Portal V2** — the client-facing view, scoped to one project: KPIs, riders, leave, documents and users, with a setup wizard per portal.

### 28. Payroll

**Operations → Payroll** is the monthly money workbook. It is organised as tabs over the same month:

| Tab | Contents |
|---|---|
| **Combined Payroll** | The SOP sheet: rider identity, the 31 day columns, and the ordered summary columns (working days, total orders, required vs actual hours, efficiency, incentive and deduction columns). |
| **Payroll** | The summary sheet per rider. |
| **Attendance & Orders** | The day grid where statuses and order counts are edited. |
| **Application Attendance** | What the app recorded, for comparison. |
| **Requests** | Payroll-affecting requests (loans, advances, penalties). |
| **Settings** | Column configuration and the pay rules. |
| **HR Payroll** (`/payroll/hr`) | The HR sheet, one column per HR field, with periods that lock once approved. |

Two behaviours worth knowing before editing:

- **The month is a snapshot.** The console computes the month once and stores it; a change to a day cell or a rule invalidates it and the next open recomputes. This is why the first open of a month can take longer than the second.
- **Statuses have meaning beyond the colour.** Editing a day to Absent, Leave, Sick, Accident, Terminated, Cancelled, New hire, Training, Phone issue, ID suspended or Vehicle issue changes both the pay for that day and the rider's visible status. Every edit is audited.

Exports match the screen: same columns, same order, same number formats, which is what makes the workbook usable in a payroll meeting.

### 29. Settings and catalogs

| Screen | What it changes |
|---|---|
| **Branding** | Console and rider app branding assets and the login hint. |
| **Driver App** | The app itself — see 21.4. |
| **Maintenance** | Puts the **console** into maintenance (only a super administrator can sign in). This is separate from the rider app switch. |
| **Roles & Permissions** | Who can open what (18.3). |
| **Staff access** | The allow-list of staff emails permitted to sign in. |
| **Driver devices** | Installed builds and sessions (19.7). |
| **Sponsorships, Employee statuses, Employee sections, Nationality Category, Driver fields, Bank codes, Companies** | The pick-lists the employee form and the payroll sheets use. |
| **Attendance thresholds** | The shift-attendance settings (20.1). |
| **Support** | Support categories and the messages used by the support screens. |
| **Cloudflare R2** | The private storage bucket used for documents and photos. |
| **Menu Editor / Languages** | The menu layout per role, and the translation catalogue. |
| **Activity Logs / Data cleanup** | The audit trail of administrative actions, and the housekeeping tools. |

> Caution: catalogs are live. Renaming a vehicle type or an employee status is safe — existing rows keep their key — but deactivating one hides it from new records while old records continue to display it. Deactivate rather than delete.

## Part IV — Appendices

### Appendix A — One rider, one day, end to end

This walkthrough ties the two surfaces together. The left column is what happens on the phone; the right column is what the office sees or does.

| # | Rider (app) | Office (console) |
|---|---|---|
| 1 | — | **Employees → Add employee**: MG ID, name, phone, zone, restaurant, project. Documents uploaded. |
| 2 | — | **Verify & approve** → passcode generated → shared privately with the rider. |
| 3 | — | **Shift attendance → Upload weekly schedule**: the rider's week is published. |
| 4 | Installs from Play, signs in with MG ID + passcode. | — |
| 5 | **Verify identity**: blinks, photo taken. | **Employee record → Login Verification Details** shows the photo. |
| 6 | Home shows the published shift, delivery rules and today's target. | **Delivery rules** and **Incentive rules** are the source of those cards. |
| 7 | At the restaurant, taps **Online**: location checked, check-in selfie taken. | **Live tracking V2** shows the rider appear, on time or late against the schedule. |
| 8 | **Add delivery** → Order ID → **Confirm pickup** (photo optional). | **Live Deliveries** shows the delivery as pending, with the pickup location and evidence. |
| 9 | Drives, then **Mark as delivered** (photo optional, OCR checked if attached). | The delivery is verified; only then does it count and pay. |
| 10 | — | A borderline delivery is flagged as an early drop; the office reviews it in **Shift attendance → Alerts** and records an outcome. |
| 11 | Home updates the DPD count and any incentive progress. | **Performance** and **DPD Verification** show the same day from the office side. |
| 12 | At the end of the shift taps **Offline** (or the shift window ends and the app checks out). | **Shift attendance → Report** shows scheduled vs worked hours. |
| 13 | Files a **Salary justification** because one order was rejected. | **EmployeeDesk** receives it; the office approves it and the order is restored. |
| 14 | — | Month end: **Payroll** is computed, verified deliveries are priced, deductions applied. |
| 15 | **Earnings → Payslips** shows the period and the net payable. | A payslip document is sent through **E-Signature**; the rider signs it on the phone; management counter-signs. |
| 16 | Books a visit for a document renewal: **Help & support → Schedule a visit**. | The booking appears in **Visit Slots → Reception**; the rider arrives and is checked in. |

### Appendix B — Status reference

#### B.1 Duty and account

| Term | Meaning |
|---|---|
| **Online / In** | On duty. Location is streamed; deliveries can be recorded. |
| **Offline / Out** | Off duty. Nothing accrues. |
| **Active** | The employee record state required for sign-in. |
| **Suspended / Inactive** | Sign-in refused. |
| **Blocked** | Sign-in refused with a reason set by the office. |
| **Frozen** | Refused inside a date window (for example an investigation). |
| **Archived** | Removed from the working list; cannot sign in. |

#### B.2 Deliveries

| Term | Meaning |
|---|---|
| **Pending** | Recorded by the rider, not yet verified by the office. Does not pay. |
| **Verified** | Accepted by the office. Counts towards targets, incentives and pay. |
| **Rejected** | Refused by the office. Can be contested with an **Order exception**. |
| **Cancelled** | Closed as cancelled, with a reason and proof. |
| **Early drop** | Completed too close to the pickup point, or too soon. A review flag. |
| **Out of zone** | Completed or recorded outside the assigned zone. A review flag. |
| **Pending sync** | Stored on the phone, not yet sent to the server. |

#### B.3 Requests

| Term | Meaning |
|---|---|
| **Awaiting ack** | Sent, not yet acknowledged. |
| **Acknowledged** | Accepted by the office. |
| **In progress** | Being handled. |
| **Solved** | Closed. |
| **Overdue** | Past the response target. |
| **Clarification needed** | The office needs an answer before it can continue. |

#### B.4 Visits and documents

| Term | Meaning |
|---|---|
| **Confirmed** | Slot booked and held. |
| **Checked in** | The rider arrived and reception scanned the ticket. |
| **Completed** | The visit took place. |
| **Cancelled / No-show** | The place was released. |
| **Opened / Signed / Awaiting counter-signature / Declined / Expired** | The five states a signature request can be in. |

### Appendix C — Assumptions, limitations and what could not be verified

A client-ready manual should be honest about the boundaries of its evidence. This appendix lists what this manual is based on, what it excludes, and where the product contains something a reader might reasonably expect to work but which the code does not support.

#### C.1 Basis of the manual

| Question | Answer |
|---|---|
| Where did the content come from? | The two repositories: the rider app's navigation graph, screens and English/Arabic string catalogues; the console's routes, menu registry, permission catalogue and string catalogues. |
| Were the applications exercised? | **No live end-to-end run was performed for this manual.** Nothing was signed into, uploaded or submitted. Procedures reflect the code path; screens were not visually confirmed in a running build. |
| Are the labels exact? | Yes for English — they are the product's own strings. Quoted messages are paraphrased where the product inserts values (distances, names, counts). |
| Are the Arabic labels covered? | The product is fully bilingual, but this manual documents the **English** labels only. |
| Is the feature list complete? | Complete for rider-facing features. Part III summarises the console at module level, not screen by screen. |

#### C.2 Older documentation that no longer describes this product

Both repositories contain documents that predate the current backend. They remain useful for context but should **not** be circulated as current truth:

| Document | Still says | Current reality |
|---|---|---|
| Rider app `README.md`, `docs/FLAVOR_INTEGRATION.md` | Supabase project, edge function `driver-passcode-login`, Supabase RPCs for login and delivery | Sign-in and operational writes go through Firebase callables (`driverPasscodeLogin`, `driverSetDutyState`, `driverCreatePickup`, `driverCompleteDelivery`, …); the console no longer calls Supabase at all. |
| Admin `docs/DRIVER_APP_HANDOFF.md` | Phone + OTP bootstrap login, Control Tower chat threads, SOS tickets, hygiene task submissions, in-app APK updates | None of these exist in the current app: no OTP path, no chat screen, no SOS action (the button reads *coming soon*), no hygiene task flow, and updates ship through Google Play only. |
| App-release references in both repos | `/app-releases` upload of APKs | The route is retired and the console no longer offers it. |

> Recommendation: retire or clearly label those documents before this manual is circulated, so readers do not look for a feature that was removed.

#### C.3 Present in the code, not exercised during this review

These paths are implemented but were not run, so the manual describes what the code does rather than what was observed:

- the **pay calculator**'s arithmetic against a real pay band;
- the **OCR order-number check** in *block* mode on a real photo;
- composing and downloading a **signed PDF** after counter-signature;
- delivering a **push notification** to a physical device;
- an **offline queue** draining after a genuine network loss;
- the **partner / client** view of the console (project-scoped, phone numbers hidden);
- **payroll** exports against a real month.

#### C.4 Behaviour that depends on configuration, not code

These are data-driven. The manual names the setting rather than a value, because the value belongs to the client and can change without a release:

| Behaviour | Where the client sets it |
|---|---|
| Check-in and pickup radius | **Settings → Driver App → Allowed distance** (`0` disables) |
| Whether a check-in selfie is required | **Settings → Driver App → Require check-in photo** |
| Early-drop threshold, far-from-customer distance | **Settings → Driver App → Delivery integrity**, and **Shift attendance** thresholds |
| OCR mode (block / warn / off) | **Settings → Driver App → Order photo OCR check** |
| Daily DPD target and incentive rates | **Delivery rules**, **Incentive rules** |
| Slot capacity and opening hours | **Visit Slots → Slots / Branches** |
| Late / early / no-login grace | **Shift attendance** setup |
| Minimum app version and forced update | **Settings → Driver App → Force update** |
| Request response targets (*Overdue*) | **EmployeeDesk → Settings** |
| Whether a fuel fill above the monthly limit is blocked | **Not enforced in the app code reviewed.** The limit is displayed and reported; any hard block is a console-side policy decision. |

#### C.5 Assumptions made while writing

1. Production is the only environment discussed; staging and test builds are out of scope.
2. The rider app is Android-only and distributed through Google Play; iOS and web are out of scope.
3. The console runs at `https://dpdadmin-prod.vercel.app`; an organisation fronting it with another hostname should substitute its own URL.
4. “Office” is used generically for the operations, HR and payroll teams; the manual does not name the client's internal departments.
5. The partner (client) console role is described from the permission catalogue, not from a live session.
6. Where the product offers two wordings for the same action (for example **Fuel reimbursement** and **Fuel refund**), the manual uses both.
7. Monetary examples are in KWD with Latin digits, as the product formats them.

#### C.6 Not covered by this manual

- **Legal and data-protection statements** — retention periods, consent wording and cross-border handling are client policies, not product behaviour.
- **Play Store publishing**, signing keys and release numbering — an engineering procedure.
- **Payroll formulas** — the SOP sheets are referenced, but the calculation detail belongs in the payroll SOP, which is maintained separately.
- **Performance and UTR definitions** — summarised only; the metric definitions are owned by the performance SOP.
- **Infrastructure and cost** — deliberately excluded.

#### C.7 Items to confirm with the client before publication

| # | Item | Why it needs a decision |
|---|---|---|
| 1 | Whether the check-in selfie is **on** by default at go-live | Changes what every rider must do at clock-in. |
| 2 | The **Allowed distance** in metres | Every pickup and clock-in depends on it. |
| 3 | The **early-drop** thresholds | They generate the flags the office reviews. |
| 4 | Whether the rider's **daily identity photo** is required for the whole fleet | It is the first thing a new rider meets. |
| 5 | The **emergency contact route**, since SOS is a stub | The manual currently tells riders to call the office's published number. |
| 6 | Which **client projects** are live (Keeta, Americana, Five Guys) | Project scoping decides which rules and portals apply. |
| 7 | An **Arabic review** of this manual | Only the English edition was produced. |
| 8 | The **maintenance intervals** for Fleet → Service, and the baseline odometer import | Until the approved intervals are stored and the vehicle baseline is imported, the Service tab reports vehicles as *Needs setup* rather than a due date. |

### Appendix D — Glossary

| Term | Definition |
|---|---|
| **MG ID / Employee ID** | The rider's identifier in the console; typed at sign-in. |
| **Client ID** | The rider's identifier in the client's own system. Distinct from the MG ID. |
| **Passcode** | The 6-digit app login credential generated on approval. |
| **Project** | The client engagement a rider works on — Keeta, Americana, Five Guys. It scopes rules, portals and reports. |
| **Zone** | A geographic polygon the office draws. Keeta riders clock in inside it and are monitored against it. |
| **Restaurant** | The pickup store a rider is assigned to. Used for the clock-in and pickup proximity gate. |
| **DPD** | Deliveries per day — the daily target a rider chases and the main efficiency measure. |
| **UTR** | Orders per attendance hour. Used in the performance dashboards. |
| **Roster** | The weekly shift schedule published by the office. |
| **Split shift** | Two working windows on the same day for one rider. |
| **Check-in gate** | The location (and optionally selfie) test that must pass before duty starts. |
| **Proximity gate** | The distance test that must pass before a pickup is recorded. |
| **Early drop** | A delivery completed suspiciously close to, or soon after, the pickup. |
| **Payout** | An approved earnings period, with deductions and a net payable. |
| **Visit** | An appointment at the office, booked as a slot. |
| **E-signature** | The rider's drawn signature on a generated document, with a legal declaration. |
| **Counter-signature** | The management signature that completes a document. |

### Appendix E — Maintaining this manual

This manual describes a product that changes weekly. Keep it accurate with three habits:

1. **When a rider-facing control changes**, update Part II in the same change. The labels in the app's string catalogue are the source of truth.
2. **When a console setting is added**, add it to the table in 21.4 or 29 — configuration is where most “the app is wrong” reports end.
3. **Re-check Appendix C** at each release. Anything that moves from *not exercised* to *verified* should be removed from that list, and anything retired should move into C.2.

Both deliverables are generated from this markdown file: `npm run docs:manual` writes the PDF and `npm run docs:manual:docx` writes the Word document. Correct the text once, here, then rebuild both — never edit the PDF or the .docx by hand.

| Revision | Date | Note |
|---|---|---|
| 1.0 | 4 November 2026 | First edition, derived from the rider app and console repositories. |

*End of manual.*




















