# Freeze + Order recon — testing summary (2026-09-22)

Migrations **pushed** to `eoksxkdssptgyqyywdju`: `20261027200000` (recon) then `20261027300000` (freeze). Admin Git + Vercel prod in the same pass. **No Play.**

In-session freeze **waits for a Play build**. Old APKs keep working on login (server reuses `driver_blocked`) but stay signed in after an admin freeze until they next log in or install the freeze-aware build.

---

## 1. Login regression (highest)

Compared `resolvePasscodeLookup` (new) to `resolvePasscodeLookupLegacy` (pre-freeze: archive → inactive → `is_blocked` only).

| Rider | Result |
|---|---|
| Active, no freeze | identical allow |
| Blocked, freeze columns NULL | identical `driver_blocked` + block reason |
| Archived | identical `driver_archived` |
| Suspended / pending | identical `driver_not_active` |
| Expired freeze (until yesterday) | identical allow |
| Future freeze (from tomorrow) | identical allow |
| Active freeze, not blocked | **new only:** `driver_blocked` + `{reason} (until {frozen_until})` |

**Old APK login (no freeze columns in the client select):** the gate is the server RPC, not the app select. After the migration, `driver_app_lookup_by_passcode` still returns `{ error: 'driver_blocked', reason }` for an active freeze. The old APK already maps that code. Confirmed by the same lookup helper the RPC will call.

Admin: `npm run test:drivers` — 142 pass (includes `driver-freeze.test.ts`).
MG-GO: `flutter test test/driver_freeze_test.dart` — 7 pass.

---

## 2. In-session detection — Play required

Cannot measure live channel latency in this pass: freeze columns are on production, but no Play APK selects them.

Path after Play + migration:

1. Admin `set_driver_frozen` updates `drivers`.
2. App `driver_access_{userId}` realtime `UPDATE` on `drivers` (`filter=id`).
3. 250 ms debounce, then `fetchAppAccessStatus` (select includes `frozen_from` / `frozen_until` / `freeze_reason`).
4. `fromDriverRow` → `enforce({ frozen: true })` → sign out → `/blocked`.

Expected once live: **about 1–3 s** from admin confirm (realtime + debounce + one select). Not measured here.

**Old APK in-session:** select is `is_blocked` + `blocked_reason` only. An active freeze with `is_blocked = false` is invisible. Unit test pins this miss. Rider stays in until next login (RPC) or Play.

`fetchAppAccessStatus` fail-opens to allowed if the select errors (columns missing). That is why this pass cannot kick a signed-in rider.

---

## 3. Precedence (Block + Freeze)

Archive → block → active freeze.

| Side | Both active | Shown |
|---|---|---|
| Login RPC / `resolvePasscodeLookup` | `is_blocked` + live freeze | **Block reason** (`Policy violation`), not freeze |
| Admin `/drivers/[id]` | two cards | Block card + Freeze card; login uses block |
| MG-GO `fromDriverRow` | both flags | `blocked: true`, `frozen: false`, reason = `blocked_reason` |

Same result on admin lookup helper and app `fromDriverRow`. Cross-checked in both test files.

---

## 4. Store-name dry-run

File: `Adjusted Order Count.xlsx` (not committed — rider PII). Parser: `parseReconXlsx`.

| Fact | Value |
|---|---|
| Shape | Wide: ID, Driver Name, Store Name, Position, then dates |
| Kuwait dates | 2026-09-01 … 2026-09-18 (18 columns) |
| Riders | 23 employee IDs |
| Stores | 21 names |
| Melt rows | 414 (23 × 18) |
| Excel order sum | 6,478 |

### Employee IDs vs `drivers` (live, not archived)

**23 / 23 found. 0 missing.**

1304, 1308, 1316, 1320, 1321, 1325, 1327, 1330, 1331, 1335, 1344, 1365, 1370, 1371, 1385, 1389, 1394, 1401, 1409, 1410, 1428, 1434, 1435.

### Store names vs `restaurants.name`

**21 / 21 byte-exact** (also 21 / 21 after `lower(btrim(...))`). No alias needed for this file.

| Excel Store Name | Match |
|---|---|
| HARDEE'S GABER EL AHMED | exact |
| HARDEES ALSHAMIYA | exact |
| HARDEES ALZAHR | exact |
| HARDEES NEW MISHREF | exact |
| HARDEES S.ALSALEM | exact |
| Hardee's Om El Himan | exact |
| KFC - Aswaq Al Qurain | exact |
| KFC - Jahra Mubarak | exact |
| KFC AL-JAHRA 2 | exact |
| KFC ALREQA | exact |
| KFC ANDALOUS | exact |
| KFC BAYAN | exact |
| KFC Fahd Alahmad | exact |
| KFC Industrial Al Gahra | exact |
| KFC Loft Fintas | exact |
| KFC MISHREF | exact |
| KFC S.ALSALEM | exact |
| KFC Saad Al Abdullah Sports Club | exact |
| KFC Saad Alabdullah | exact |
| KFC s.soura | exact |
| KFC village | exact |

### App counts + live `admin_order_recon_compare` (2026-09-22)

Kuwait `delivered_at` on 2026-09-01…18. Performance stays **verified only**. Recon is provisional **`pending` + `in_transit` + `verified`** (`20261027400000`; client to confirm).

Independent `deliveries` count **and** production RPC (staff JWT):

| Lock | 23 IDs | Fleet |
|---|---|---|
| verified only (old) | 5 | 88 |
| logged (pending 2522 + in_transit 0 + verified 5) | **2527** | **58,429** |

- Excel sum on the 414 melted rows: **6,478**.
- `difference = app − excel`: **`bad_diff_sample = 0`**, **`bad_diff_all = 0`**.
- Sample `diff_sum = 2527 − 6478 = −3951` (~39% of Excel logged in app). Residual is partner-sheet orders with no app row — not a join/date bug.
- Sample rows: 414 (22 match, 345 mismatch, 201 excel-only, 9 app-only).

Admin: `npm run test:recon` after the `no_date_columns` parser fix.

---

## 5. No Play in this pass

| Surface | This pass | After Play |
|---|---|---|
| Login while frozen | Works for **old APKs** once the RPC is pushed (`driver_blocked`) | Same |
| In-session freeze → `/blocked` | **Does not run** on installed APKs | New select + `fromDriverRow` |
| Freeze title / until copy | Not on Play | `accessFrozen` / `accountFrozenDefault` |
| Clock-in while frozen | Server refuse after RPC push | App shows existing blocked screen |

---

## Automated results

| Suite | Result |
|---|---|
| `npm run test:drivers` | 142 pass |
| `npm run test:recon` | 7 pass (parser + resolve) |
| `npm run test:vehicles` (menu relocate) | run with recon |
| `flutter test test/driver_freeze_test.dart` | 7 pass |

Not run: live admin freeze on a signed-in phone, Play.
