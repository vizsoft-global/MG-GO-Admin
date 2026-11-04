# Fleet Service — approved intervals, per-program maintenance, odometer feeds

What this release changes, what it needs from the client, and what is explicitly
**not** in it.

---

## 1. Maintenance is per program, not per vehicle

Before, a vehicle resolved **one** interval. A "full service" record therefore
moved oil, tyres and brakes at once, and there was no way to say "the oil is due
but the tyres are fine".

Now a vehicle carries one row **per program**:

| Program | Scheduled on | Approved interval | Alert |
|---|---|---|---|
| Oil change | car, bike | bike 1,500 km / 10 days · **Toyota** 10,000 km / 180 days · **Hyundai** 5,000 km (no day interval) | 500 km or 5 days |
| Front tyres | car | 50,000 km (no day interval) | 500 km |
| Rear tyres | car | 60,000 km (no day interval) | 500 km |
| Brakes | car / bike | car 30,000 km · bike 45 days | 500 km or 5 days |
| Chain | bike | 45 days | 5 days |

`0` on a dimension is how a rule says **not tracked there**. The table prints a
dash for it — never `Unknown`, and never a fabricated due date.

**There is no fleet-default fallback.** A vehicle the approved rules do not cover
(Changan, ISUZU, Ford, Honda in the client's sheet) shows an explicit **No rule**
state with an *Add rule* action. It is never computed from an unapproved default
and never printed as `Unknown`; the fleet-default numbers stay in
`service_maintenance_settings` only as the seed a new rule starts from.

The alert window is **500 km or 5 days, whichever is reached first**. It replaces
the provisional 500 / 14 days.

Resolution order for a rule: the vehicle itself → its make/model → its make → its
vehicle type. `Confirm intervals` still records who approved the fleet defaults.

## 2. Nine cars the fleet did not hold are created, not skipped

The client's sheet (`Service Cars.xlsx`) names 189 cars. 180 matched a vehicle by
plate; nine did not:

```
23/21208   22/21543   21/98175   21/98460   90/17598
23/21120   23/21151   23/21189   23/21198
```

These are real cars with real history — the first alone carries 74,721 km and a
service dated 18/10/2026 — so the importer **creates** them as cars with their
plate, chassis, make, model and current odometer, and writes their last service
onto them.

No duplicates, on three levels:

- **In the file** — two rows sharing a plate or a chassis create one vehicle and
  the second row is reported.
- **In the fleet** — every row is matched on plate *and* on chassis against the
  whole fleet before anything is created, so a car already held under a different
  plate is found.
- **On a re-run** — an already-created car is found by its own plate the second
  time, so applying the same sheet twice creates nothing.

The sheet's own `Next Km` is checked against `last service + the approved
interval`. A disagreement is **reported**, not silently accepted.

Partial rows are legal: 17 rows in the sheet have no last-service date and 14 have
no last-service kilometres. A row with only one of them counts that dimension and
leaves the other in **Needs setup**.

`0` in `Current KM`, `last service` or `Next Km` is read as **"no figure"**, not as
a zero — no vehicle in this fleet is at 0 km, and reading the zeros literally made
thirteen rows look like a `Next Km` disagreement.

**A row whose `Current KM` is below its last-service figure has its odometer write
blocked.** It is still imported — the vehicle and its service history are real —
but nothing may rewind the meter until the sheet is confirmed. The client's sheet
has **36** such rows; the preview lists them with both figures and the apply step
skips their odometer.

### Dry-run on the client's sheet (read-only)

`node --import tsx scripts/service-baseline-import-dry-run.mjs` reads the sheet at
`scripts/fixtures/service-cars.xlsx`, the live fleet (307 vehicles), the approved
rules, and prints:

```
sheet rows (incl. header): 190   header row: 1
fleet vehicles: 307   rules: 8 (approved)

matched by plate  : 180
matched by chassis: 0
created (new car) : 9
rejected          : 0
total             : 189

blocked (Current KM below last service): 36
Next Km disagreements: 6 / 189
  16/15465   305,000 + 5,000 = 310,000   sheet says 320,000
  16/25772   300,950 + 5,000 = 305,950   sheet says 310,950
  80/83476   114,000 + 10,000 = 124,000  sheet says 114,000
  50/55665   111,552 + 5,000 = 116,552   sheet says 120,000
  60/72285    50,000 + 5,000 = 55,000    sheet says 60,000
  80/78669    79,000 + 10,000 = 89,000   sheet says 111,000
```

`--rules=stored` runs the same preview against what is in Firestore today (the seed
is not applied, so nothing resolves) — that is the difference between "the matcher
is wrong" and "the rules are not seeded yet".

## 3. Bajaj Care is Phase 2

Bike service records reach us today through **Excel/CSV import** and **manual
entry** on `/fleet/service/bikes`, and bike maintenance calculates correctly from
those records. Reading them directly from Bajaj Care is a **separate
integration** and is not part of this release.

To start it we need four things from the client:

1. the API **base URL**,
2. the **authentication scheme and credentials**,
3. the **endpoint** that returns a bike's service history — or, if no API exists,
   a **periodic export** (CSV/Excel) of the same data,
4. the **field names** for service date, odometer and service type.

## 4. Bike odometer

The rider app will capture the bike's **absolute meter reading at shift-out**.
That is an app release, so until the build reaches the fleet:

- the figure is corrected with **Update Odometer** in the panel, and
- `/fleet/service/bikes` lists which bikes have **no reading** and which have a
  stale one (older than seven days), one click from the correction.

**A person may lower a reading.** A typo, a replaced instrument cluster or a reset
meter all need the figure to come down, so the admin dialog allows it when a
**reason** is typed: the previous figure, the new figure and the reason are stored
on the reading and in the audit log. The monotonic guard that refuses a lower
figure stays where nobody is watching — the dashcam sync and the baseline import.

GPS distance is carried **alongside**, never instead: it under-reads indoors and
in tunnels, over-reads on scatter, and drifts from the bike's own meter every
month. The two are stored as separate fields for that reason.

## 5. The dashcam feed

Cars are read from the vendor's fleet API **four times a day**
(`00:00 / 06:00 / 12:00 / 18:00` Kuwait).

The published specification (`vssgpsmea.live/api-docs`) answers **500** from
outside the vendor's network, so the endpoint shape ships as **configuration**:
base URL, `AppCid`, vehicles path and the three field names are entered in
**Fleet Service → Maintenance → Dashcam odometer**, and **Test connection** calls
the path and shows the raw first row it returns.

**`AppSecret` is never stored in Firestore.** It lives in **Secret Manager** for the
scheduled run (`firebase functions:secrets:set SERVICE_ODOMETER_APP_SECRET`) and in
the **Vercel environment** for the panel's Test connection. The dialog shows only
*Secret configured* / *Secret missing*, and the audit row records that flag — never
the value.

That means the real field names are settled in the panel, without a deploy — and
the sync writes nothing until those fields are filled in.

Two rules the sync will not break:

- a reading only ever moves the stored figure **up**; a lower figure is skipped
  and logged, never written, because a rewind would hide every overdue service;
- matching is **chassis first**, then the normalised plate. A row that matches
  neither is counted in the run log and never guessed by model.

## 6. Open questions

1. Are those nine plates the **only** fleet additions, or does the client expect
   more vehicles that are not in this sheet either?
2. Bajaj Care's API contract (or a periodic export) — needed before Phase 2 can
   start.
3. The rider-app release that captures the shift-out odometer reading is tracked
   as an app task, not assumed.
