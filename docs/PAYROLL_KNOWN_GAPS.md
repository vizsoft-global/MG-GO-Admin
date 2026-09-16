# Payroll & Requests — known gaps

This hub does not invent columns or departments the live schema cannot support. `/earnings` (KWD) and `/requests` (RCM) stay as they are.

## Travelled

The SOP / spreadsheet has a Travelled day status. Nothing in `attendance_logs`, `requests`, or deliveries records a travel day. The classifier never emits `travelled`. Do not proxy this from GPS distance or out-of-zone time.

## Cancelled

The prototype had a Cancelled column (cancelled deliveries). Payroll work is attendance check-in, not orders. Cancelled deliveries are out of scope; the locked grid has no Cancelled column.

## Safety & Legal

SOP step 3 copy names Safety & Legal as a reviewing department. Production approval chains are Reporting Manager / HR / Payroll / Fleet (plus Operations / Finance where templated). The Approval Workflow panel keeps the SOP wording. Live **Reviewing dept.** on a request row is `current_step_label` or the first pending `request_approval_steps` row — never the string `Safety & Legal` unless a live step is actually named that.

The Accident tile’s static “Safety & Legal” chip is the same SOP label, not a live queue.

## `source_company`

The Company slicer reads `drivers.source_company`. Rows with a null / blank company drop out of a company filter (empty slicer = all). Coverage is as-filled; this module does not backfill.

## Never-clocked-in riders

The roster is every non-archived driver. A rider with no `attendance_logs` row in the month is **Absent** on every Kuwait day ≤ today, not omitted. Future days stay blank. They still count in Riders in payroll and pull Avg efficiency down.

## Other locked omissions

- Work / `12` is a check-in that Kuwait day, not a Performance working day (verified orders).
- Efficiency is uncapped (`work / FixedDays × 100`). Fixed Days = calendar days − 2.
- Unjustified counts OFF / Sick / Accident without `approved` or `awaiting_driver_ack`. Absent never needs a request.
- Month selector is exactly three buttons (Kuwait current + previous 2). No older archive.
- RPC `admin_payroll_month_snapshot` is live (`20261025100000` plus `00010`/`00020` enum and month-days casts). The table-query fallback uses the same start_date/end_date overlap as the RPC — never `created_at` in the selected month. A request filed in September that covers only August or November does not appear in September.
