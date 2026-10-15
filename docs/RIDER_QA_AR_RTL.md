# Rider app — Arabic + RTL QA (real device)

Manual checklist for a **physical phone**. Do not treat any item as already passing. Tick a row only after a human has done the action on glass and seen the expected result.

| | |
|---|---|
| App | MG-GO rider (`C:\Users\Admin\Desktop\Vizsoft\MGgo-User\MG-GO`) |
| Branch / version | `vk-firebase-dev` · **1.1.25+102** (do not rebuild or publish for this run) |
| Locale | Arabic (`ar`) — set in the app, force-stop, reopen so RTL is process-wide |
| Device | Android (required for `FLAG_SECURE` / recents thumbnail). iOS: screenshot-detect + blur only |
| Font | Default first. If time, re-spot overflow at system 1.3× |

**Shared fail on every item:** chrome stays LTR (back chevron, icons, FAB, bottom nav); yellow/black overflow or clipped Arabic; Latin month tokens (`Jan`…`Dec`, `Aug`) on a date that should use ARB `monthJan`…`monthDec` / `monthAug` (`أغس` / `أغسطس`); screenshot / recents thumbnail wrong for a `FLAG_SECURE` screen.

Tester: ___ · Device / OS: ___ · Date: ___

---

## 1. Login RTL and passcode

- **Screen:** Login (`login_screen`) — employee ID + 6-digit passcode (`رمز الدخول`).
- **Action:** Open a signed-out app with locale `ar`. Type employee ID and passcode. Rotate the device once.
- **Expected:** Whole sheet is RTL. Labels and fields start on the right. Digit passcode stays LTR inside the field. No overflow at default or 1.3×. Error copy (invalid / archived / blocked) is Arabic, not a raw code.

## 2. Home chrome and bottom nav

- **Screen:** Home (`home_screen`) inside the five-tab shell (Home · Deliveries · Earnings · Vehicle · Profile) plus the raised Add Delivery FAB.
- **Action:** Land on Home after login. Scan the greeting, duty toggle, cards, and the bottom bar. Tap each tab once and return.
- **Expected:** App bar, cards, and tab row mirror. FAB sits in the centre gap and does not cover Arabic labels. Tab labels are Arabic and single-line or wrap without clipping. System back from a pushed route does not exit the app.

## 3. Home Extra Earnings and Daily DPD

- **Screen:** Home — Extra Earnings quest card (`incentive_quest_card`) and Daily DPD (`daily_dpd_target_card`, `هدف DPD اليومي` / `أرباح إضافية`).
- **Action:** Scroll Home until both cards are fully visible. Open Extra Earnings if the card offers a tap-through.
- **Expected:** Cards are RTL. Progress bars fill from the end edge. Copy is Arabic (including remaining-count). No leftover `KD PER ORDER` band labels. Numbers (KWD, counts) stay readable. No overflow on a long restaurant name.

## 4. Home attendance clock-in and Time in

- **Screen:** Home duty toggle + This Week’s Progress Time in; optional Attendance (`attendance_screen`).
- **Action:** Clock in (complete the shift-time sheet if shown). Confirm Time in starts. Open Attendance. Clock out, then clock in again.
- **Expected:** In/Out and Time in labels are Arabic and mirrored. Shift sheet fields and buttons are RTL, ≥48 dp, above the system nav. Second clock-in does not flash a stale In from a previous rider. Attendance month headers use ARB months, never `Aug`.

## 5. Out-of-zone banner and countdown

- **Screen:** Home zone chip (`zone_status_chip`, `خارج المنطقة`) and the 45-minute out-of-zone banner (on duty, including during an open pickup).
- **Action:** Clock in, leave the assigned zone with GPS on, keep the app in foreground. Start a pickup if one is available and stay outside. Return to the zone before 45:00.
- **Expected:** Chip and banner are Arabic, RTL, not clipped. Countdown does not reset when a pickup is open. Returning inside the assigned zone (0 m buffer) clears the banner. Clock-out freezes remaining time; clock-in still outside resumes it (does not restart at 45:00).

## 6. Deliveries list calendar months

- **Screen:** Deliveries (`deliveries_screen`) calendar + day list.
- **Action:** Open Deliveries. Change day on the calendar. Open a past day that has rows.
- **Expected:** Calendar is RTL (week starts on the end edge). Month title uses ARB (`أغسطس` / `أغس`), not `August` / `Aug`. Order IDs stay LTR inside RTL rows. Status chips are Arabic. No overflow on a long rejection reason if one is listed.

## 7. Pickup Add Delivery

- **Screen:** Add Delivery / Pickup (`add_delivery_screen` + rear-camera capture). From Home FAB or Deliveries **إضافة توصيل**.
- **Action:** Clock in. Open pickup. Enter a 1–32 digit Order ID. Take the required rear-camera stills. Submit inside range. Repeat once with letters in the Order ID (must refuse). Repeat with no published restaurant if that rider exists (`no_restaurants_assigned`).
- **Expected:** Form, keyboard, and camera chrome are RTL. Gallery / front camera are not offered. Proof row reads as attached in Arabic. Duplicate / out-of-range / no-restaurant errors are Arabic sentences, not raw codes. No overflow on the proof strip.

## 8. Active Delivery footer

- **Screen:** Active Delivery (`active_delivery_screen`).
- **Action:** After a successful pickup, open Active Delivery. Stand the phone on a device with a gesture / 3-button nav bar.
- **Expected:** **تعليم كمُسلّم** and **إلغاء الطلب** sit above the system inset (`viewPadding.bottom`), full width, mirrored (destructive vs primary still distinct). Device Back / app-bar back goes Home — does not kill the process. Order ID stays visible offline.

## 9. Mark as Delivered

- **Screen:** Finish delivery (`finish_delivery_screen` + rear camera).
- **Action:** From Active Delivery, Mark as Delivered. Capture optional rear stills. Submit. Land on Thank You / success (`delivery_success_screen`).
- **Expected:** Screen and camera are RTL. If the rider was Out, Clock In overlay is Arabic and sticks (Back after overlay Clock In does not clock them out again). Success screen Back goes Home. Dates on the receipt use ARB months.

## 10. Cancel Order

- **Screen:** Cancel from Active Delivery (same finish/cancel camera path).
- **Action:** Start a new pickup, Cancel Order, capture the required rear still, enter / pick a reason, submit.
- **Expected:** Cancel is visually destructive vs Mark as Delivered. Reason field and chips are Arabic, RTL, no overflow. Camera deny shows human Arabic copy, never `PlatformException(camera_access_denied, …)`. After cancel, FAB returns to Add Delivery.

## 11. Inbox list RTL

- **Screen:** Notifications inbox (`notifications_inbox_screen`, `الإشعارات`).
- **Action:** Open the inbox with a mix of campaign, delivery verify/reject, request, visit-note, and e-sign rows. Pull to refresh. Swipe / clear one row if offered.
- **Expected:** List is RTL. Titles and bodies are Arabic (or the campaign’s AR text) — no blank transactional rows. Timestamps are readable and use ARB months where a named month is shown (no `9 Aug`). Unread badge and swipe affordances mirror. Dismissed rows stay gone.

## 12. Restricted notification FLAG_SECURE

- **Screen:** Inbox → a `screenshot_restricted = true` detail (Force ON / inherit restricted). Rider must **not** have `drivers.screenshots_allowed`.
- **Action:** Open the restricted item. Try a screenshot. Switch to Recents. Close the detail and try a screenshot on Home.
- **Expected:** Android: screenshot is blocked / black; Recents thumbnail is blank while the detail is open. Restricted chrome (lock / blocked copy) is Arabic and RTL. Closing the detail restores the app’s usual secure posture. Do not leave screenshots permanently allowed.

## 13. Unrestricted notification screenshot allow

- **Screen:** Inbox → a `screenshot_restricted = false` detail (Force OFF). Same rider, `screenshots_allowed` still false.
- **Action:** Open the unrestricted item. Take a screenshot. Leave the detail. Take a screenshot on Home. Re-open a restricted item afterwards.
- **Expected:** While the unrestricted detail is open, `FLAG_SECURE` is cleared and a screenshot works. On close, global secure returns — Home / Recents must not stay capturable if the rest of the app is secured. A following restricted open blocks again.

## 14. Support hub overflow

- **Screen:** Help & Support hub (`support_hub_screen`, `المساعدة والدعم`).
- **Action:** Open Profile → Help & Support. Scan every tile (built-in types + any custom type). Bump system font to 1.3× and reopen.
- **Expected:** Tiles are RTL, paired rows share height, labels wrap (including long `label_ar`). No overflow, no clipped last letter. Custom type shows `label_ar`. Complaint categories use Arabic catalogue labels (`مدفوعات`, `مشاكل الراتب`, …) — Attendance category must not read like app “sign in” if the copy is still `تسجيل الدخول`.

## 15. Request detail ARB dates

- **Screen:** My Requests (`my_requests_screen`) → Request detail (`request_detail_screen`).
- **Action:** Open a request that has a timeline (approved / clarified / decided). Read every date on the list row and on the detail timeline.
- **Expected:** Both surfaces use ARB months (`9 أغس` / `9 أغسطس 2026`), never `9 Aug`. Codes (`RCM-####`) stay LTR inside the RTL line. Admin response, rider note, and attachment rows start-align and wrap. No UUID / raw payload dump.

## 16. Leave Decline and Accept

- **Screen:** Request detail on a leave (or sick-leave) row that still offers rider Decline / Accept (reschedule or ack).
- **Action:** Open that request. Look at the Decline / Accept row. Tap Decline once (cancel if you must not consume the request), then Accept on a disposable row if available.
- **Expected:** The pair matches the Ask-question / Add-note row geometry (same height, 12 radius, single-line ellipsis). Decline is outlined destructive; Accept is filled primary — they must not look like two identical ghosts. Copy is Arabic. Dates on the reschedule card use ARB months. From is named before To.

## 17. E-Sign documents inbox

- **Screen:** E-Sign inbox (`esign_documents_screen`, `/profile/support/sign`).
- **Action:** Open Sign. Switch All / Not opened / Opened-not-signed if those chips exist. Open a pending row and a signed-awaiting-counter-signature row.
- **Expected:** Inbox is RTL. Chips and filters mirror (emerald / selected state still obvious). Due dates use ARB months, not a numeric-only `18-08-2026` that reorders under bidi. Awaiting counter-signature is labelled as waiting on staff, not as finished. Declined rows show `declined_reason`.

## 18. E-Sign viewer FLAG_SECURE

- **Screen:** E-Sign viewer (`esign_viewer_screen`) + full document (`esign_full_document_screen`).
- **Action:** Open a **restricted** document (`screenshot_restricted` live category = true). Confirm the amber banner (`لقطات الشاشة معطّلة لهذا المستند`). Try a screenshot. Open Full Document in-app. Then open an **Allowed** category document and try a screenshot.
- **Expected:** Restricted: banner RTL, `FLAG_SECURE` on, Recents blank, Full Document stays in-app (no Notes / Downloads / “Starting download”). Details card shows `label_en` **and** `label_ar` when both exist; bank number is masked. Allowed: screenshots work while open; fail-open if the live flag is missing is **not** acceptable — missing flag is fail-closed. Device Back returns to the inbox, not out of the app.

## 19. E-Sign signature pad RTL

- **Screen:** Signature capture (`esign_capture_screen`) → confirmed (`esign_confirmed_screen`).
- **Action:** Sign a disposable pending document. Tick the legal declaration. Submit. If a staff countersignature is pending, stay on confirmed.
- **Expected:** Pad mirrors — `✕` and baseline start on the right. Declaration is Arabic (`أقر بأن هذا توقيعي الإلكتروني المعتمد قانوناً.`). Footer Decline / Sign order swaps under RTL. Confirmed does not open a composed signed copy while `awaiting_counter_signature` is true. Receipt dates use ARB months.

## 20. My Visits ticket QR

- **Screen:** Visit booking flow (`visit_booking_flow_screen`) → My Visits (`my_visits_screen`) + ticket.
- **Action:** Book a slot (department list must be Arabic `label_ar`). Open My Visits. Open the ticket. Read `note_to_rider` if Admin set one. Trigger an overlapping slot once to see the snackbar.
- **Expected:** Wizard, slot grid, and list are RTL. Past Kuwait-today slots are hidden. Ticket QR stays on the **trailing** edge at 48 pt. Booking code / `رمز الحجز` stays LTR inside Arabic. Dates use ARB months. `overlapping_visit` shows `لديك زيارة في هذا الوقت. اختر موعداً آخر.` — never the raw code. Back hides the bottom bar the same way as other Profile pushes.

## 21. Extra Earnings pending verification

- **Screen:** Extra Earnings (`extra_earnings_screen`) and Earnings day detail (`earnings_day_detail_screen`).
- **Action:** After a pickup (not yet admin-verified), open Extra Earnings and the day detail for today. Compare Home quest progress with the day-detail items.
- **Expected:** Screens are RTL. Progress may count submitted orders; payout / lock stay verified-only. A crossed target that is not yet verified reads as pending verification in Arabic (`X/Y` verified — verification pending), not as a paid reward. Overridden rules are labelled, not advertised as payable. KWD uses 3 decimals. No overflow on long rule names.

## 22. Profile Sign out

- **Screen:** Profile (`profile_screen`) — **تسجيل الخروج**.
- **Action:** While on duty with Time in running, tap Sign out. Read the confirm sheet (`تسجيل الخروج؟` / `ستحتاج رقم السائق ورمز الدخول لتسجيل الدخول مجدداً.`). Confirm. Sign in again on the same phone.
- **Expected:** Dialog is RTL; Cancel vs Sign out are visually distinct. Confirm clocks out before device release (Time in stops; next login is Out and may ask for shift times). Cleanup finishes without hanging more than a couple of seconds. Login is Arabic/RTL. The new session must not flash the previous rider’s photo, duty state, or inbox.

---

## How to record

For each item write **Pass / Fail / Blocked** and a one-line note (screenshot only if `FLAG_SECURE` is not the thing under test — a black capture on items 12 and 18 restricted is expected on Android).

| # | Title | Result | Note |
|---|-------|--------|------|
| 1 | Login RTL and passcode | | |
| 2 | Home chrome and bottom nav | | |
| 3 | Home Extra Earnings and Daily DPD | | |
| 4 | Home attendance clock-in and Time in | | |
| 5 | Out-of-zone banner and countdown | | |
| 6 | Deliveries list calendar months | | |
| 7 | Pickup Add Delivery | | |
| 8 | Active Delivery footer | | |
| 9 | Mark as Delivered | | |
| 10 | Cancel Order | | |
| 11 | Inbox list RTL | | |
| 12 | Restricted notification FLAG_SECURE | | |
| 13 | Unrestricted notification screenshot allow | | |
| 14 | Support hub overflow | | |
| 15 | Request detail ARB dates | | |
| 16 | Leave Decline and Accept | | |
| 17 | E-Sign documents inbox | | |
| 18 | E-Sign viewer FLAG_SECURE | | |
| 19 | E-Sign signature pad RTL | | |
| 20 | My Visits ticket QR | | |
| 21 | Extra Earnings pending verification | | |
| 22 | Profile Sign out | | |
