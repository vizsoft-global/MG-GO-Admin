# Rider Compliance Upload + Driver Pay Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three gaps left by the first pass on the client's two feature requests — an Admin bulk-upload tool that writes `rider_compliance_daily`, an Admin route for the existing pay-plan editor, and the rider app's Pay Calculator screen — so the compliance counters and the calculator stop reading zeros.

**Architecture:** The read paths already exist and are deployed (`driverGetHomeDashboard.week.invalid_days/rejected_orders/cancelled_orders`, `driverGetPayCalculator`, and the admin-side `computeDriverPay` engine in `src/features/payroll/driver-pay-plan.ts`). This plan adds only the **write** path, the missing **Admin route**, and the missing **rider screen**. No new Cloud Function: the repo's staff-write posture is "Admin SDK on the server after a permission check", so the upload is a Next server action that writes Firestore directly and then calls the already-deployed `adminNotifyComplianceRefresh` callable for the real-time push.

**Tech Stack:** Next.js 16 (App Router, server actions, next-intl, Tailwind + shadcn tokens), `xlsx` via `@/lib/import/spreadsheet`, Firestore `default` via `firebase-admin` (`staffDb()`), Cloud Functions v2 on `me-central1` (no new deploy), Flutter 3.44 / Dart for the rider screen.

**Spec:** Client request 2026-10-16 — "Rider App Compliance Dashboard & Admin Bulk Upload Tool" and "Driver Pay & Incentive Calculator", plus the coverage audit in this session (gaps: no `rider_compliance_daily` writer, no pay-plan editor route, no rider calculator UI).

---

## Corrections applied in review round 2

Eight review findings were folded into the tasks. Where a step was wrong, the step changed; nothing lives only in this list.

| # | Finding | Where it is fixed |
|---|---|---|
| 1 | `employee_id` **or** `driver_code` is the requirement, metric columns stay optional, and a file missing a required column must not be applicable | Upload contract below; Task A1 Steps 3-4; Task A2 Step 3 (`missing_columns` refusal); Task A3 Step 2 (Apply disabled + banner) |
| 2 | Never trust client statuses or metric values — revalidate and normalize server-side | Task A2 Steps 2-3 (actions take the **raw sheet** and re-parse it); Task A1 Step 4 (`normalizeCell`) |
| 3 | Duplicate rider-day must be caught across both ID columns | Task A1 Step 4 (`dedupeResolvedRows`, keyed on the resolved `driver_id|day`); Task A2 Step 2 calls it |
| 4 | A partial write must never be reported as "nothing was written" | Task A2 Step 3 (`partial_write` carries `writtenRows`, and the refresh still runs for the rows that committed); Task A5 copy |
| 5 | Verify the pay-plan key: `invalid_ladder` vs `invalid_days_ladder` | Task B0 (read-only audit + a schema-pinning test), and the finding below |
| 6 | Staging/emulator for end-to-end; no production write without approval | Task A6 (three tiers + emulator scripts); Task B1 Steps 4-6; "Before claiming done" |
| 7 | Keep the rider-app approval gate | Task C0, unchanged, and named by Task A6's tier 3 |
| 8 | Run tests, typecheck, lint and build; report blockers | "Before claiming done" |

### Finding 5, stated plainly (verified in the code, not assumed)

- The stored key is **`invalid_ladder`**. `payPlanToFirestore` writes it (`src/features/payroll/driver-pay-plan.ts:225`), the admin parser reads it (`:197`), the deployed reader reads only it (`functions/src/rpcs/driver-pay.ts:148,158`), and the rider parser reads it (`lib/features/earnings/pay_plan.dart:285`).
- **`invalid_days_ladder` does not exist in any reader, writer, parser or editor.** Writing that key would be silently ignored by the deployed function, and the rider app's ladder would snap back to 7 / 21 / 120. An earlier draft of this plan printed that name in Task B1's verification step; that was wrong and is corrected.
- The camelCase **`invalidLadder`** is tolerated by the admin parser (`:197`) and the Dart parser (`:285`), but **not** by the deployed function.
- Consequence today: only the editor's writer path is safe, because it emits the snake_case key. A hand-written or older document carrying only `invalidLadder` is read as the default by the function. Fixing that means editing and deploying a Cloud Function, which is **out of scope without approval** — it is recorded as an approval-gated follow-up in Task B0 Step 4, not done silently here.

---

## Global Constraints

**From the client**
- F1 UI: home "This Week's Progress" shows Invalid Days, Order Rejections, Cancelled Orders. (Already built — verified in Task A0.)
- F1 Admin: "bulk-upload CSV/Excel files containing rider IDs mapped to these compliance metrics".
- F1 Sync: an upload "must sync immediately to update the rider's app interface".
- F2 Inputs: valid completed orders, vehicle (Bike vs. Car), rejected/cancelled orders, invalid days.
- F2 Output: base payout, tiered bands (301–400 @ 0.260 KD, 401–500 @ 0.350 KD), penalties (−2 bike / −3 car), net monthly pay.
- F2 Reference: per-order brackets — Under 300, 301–400, 401–500, 501–600, Above 600.

**Repo rules (non-negotiable)**
- UI: `.cursor/rules/ui-system.mdc` — `h-9` controls, `AppModalFooter` footer-first modals, semantic colour tokens, no `transition-all`.
- Every user-facing string lands in **both** `src/messages/en.json` and `src/messages/ar.json`; `node scripts/check-messages.mjs` must print `messages OK`. Rider repo: edit `lib/l10n/app_en.arb` + `app_ar.arb` then `flutter gen-l10n` (generated files are tracked).
- Adding an admin page = three edits: `src/lib/auth/permission-catalog.ts`, the `MENU_REGISTRY` item, `requirePermission(locale, slug)` on the page. Bump `MENU_CACHE_VERSION` in `src/hooks/use-sidebar-menu.ts`.
- A server action that calls a **mutating** admin RPC must be gated (`requireMutationAuth(...)`) or `src/lib/auth/mutation-auth-coverage.test.ts` fails. `isMutatingAdminRpc` treats any name containing a write verb (`import`, `save`, `upload`, …) as mutating.
- `rider_compliance_daily` documents are **`{driverId}_{day}`**, `day` = Asia/Kuwait `YYYY-MM-DD`. Readers: `functions/src/rpcs/driver-home.ts:279-306` (week) and `functions/src/rpcs/driver-pay.ts:238-263` (month). A missing document is a zero, never an error.
- The notify callable caps one call at **500** driver ids (`MAX_REFRESH_DRIVERS`, `functions/src/rpcs/driver-pay.ts:29`). `WriteBatch` is capped at 500 writes. Chunk both.
- **Approval gates — three, all mandatory, no exceptions.**
  1. **Rider app code** (Phase C) needs the owner's explicit go-ahead. Task C0 is that gate.
  2. **Any write to production data** — `rider_compliance_daily` rows, `app_settings/1.driver_pay_plan`, any document — needs explicit written approval. Reading production is fine.
  3. **Any deploy** — `firebase deploy` (functions, rules, indexes), `vercel --prod`, a Play release — needs explicit approval. Phases A and B require **no** Cloud Function deploy, so this gate should never be reached by this plan.
- **Verification tiers, in order.** Offline tests → Firestore emulator → staging project → production *only after approval*. Task A6 defines the tiers and the scripts; a step that skips a tier is a bug in the step.
- No `--force` on any deploy; one Cloud Function name at a time. Admin prod, when approved: `vercel deploy --prod --yes --regions fra1`, then `vercel inspect dpdadmin-prod.vercel.app`.
- Commit only when the owner asks. Tests: `node --import tsx --test <files>`, wired into a `package.json` script.

### Upload contract (locked here; every task assumes it)

Template columns, header row required, case-insensitive, whitespace- and hyphen-tolerant, order irrelevant. **Required** means the file cannot be applied without it. **Optional** means absent is legal and every row's value for that metric is zero.

| column | class | rule |
|---|---|---|
| `day` | required | `YYYY-MM-DD`, not in the future |
| `employee_id` | one of the identity pair is required | AM ID, e.g. `40028` |
| `driver_code` | one of the identity pair is required | MG ID, e.g. `10955` |
| `invalid_days` | optional | integer `0–31`, blank = 0 |
| `rejected_orders` | optional | integer `0–9999`, blank = 0 |
| `cancelled_orders` | optional | integer `0–9999`, blank = 0 |

Consequences, spelled out because each was a review finding:

- **Missing required column ⇒ the file is refused.** Absent `day`, or absent *both* identity columns, blocks the preview from being applicable: the Apply button is disabled and the server refuses the call with `missing_columns`. An optional metric column being absent is **not** a refusal — it is recorded and shown, and those cells count as zero.
- **Normalisation happens on values, not just headers.** Cell values are trimmed and stripped of zero-width/BOM characters, and Arabic-Indic digits (`٠-٩`) are folded to ASCII before numeric parsing, so a file exported from a Kuwaiti Excel sheet reads the same as one typed in English.
- **The server owns the truth.** The browser sends the parsed **sheet** (headers + raw cells), never a row status or a metric value. Both actions re-run `parseComplianceSheet` server-side and use only their own result; a status or number sent by the client has no effect on what is written.
- **Duplicate policy is by resolved rider, not by typed id.** After resolution, two rows that land on the same `driver_id` + `day` count as duplicates **even when one row carried `employee_id` and the other carried `driver_code`**. First occurrence wins and is written; the later one is marked `duplicate` and is not. Re-uploading a corrected file for the same rider-day overwrites that day — that is the only supported way to fix a value.

Row statuses: `ok`, `unknown_id` (no live rider matched), `ambiguous` (employee_id and driver_code name two different riders), `invalid_day`, `invalid_number`, `duplicate` (same rider+day twice in one file, including across the two id columns). Only `ok` rows are written. A row that is `ok` with every metric blank writes zeros — that is how ops clears a day.

---

## File Structure

**Phase A — compliance upload (admin only)**
- Create `src/features/compliance/compliance-parse.ts` — pure and database-free: header/column checks, cell normalisation, day and metric parsing, row statuses, resolved-row dedupe, the write builder, and the chunked commit that reports how far it got.
- Create `src/features/compliance/compliance-parse.test.ts` — unit tests for all of the above.
- Create `src/features/compliance/types.ts` — shared row/result types.
- Create `src/features/compliance/compliance-upload-actions.ts` — `"use server"`: re-parses the raw sheet, refuses a file missing a required column, gated apply + notify.
- Create `src/features/compliance/rider-compliance-upload-shell.tsx` — the page shell.
- Create `src/app/[locale]/(dashboard)/compliance/page.tsx` — the route.
- Create `scripts/compliance-emulator-check.mjs` — the emulator proof of the write plan.
- Modify `src/lib/firebase/db.ts`, `src/lib/auth/permission-catalog.ts`, `src/lib/menu/menu-registry.ts`, `src/hooks/use-sidebar-menu.ts`, `src/messages/en.json`, `src/messages/ar.json`, `package.json`, `firebase.json` (local emulators block).

**Phase B — pay-plan editor route (admin only)**
- Create `src/app/[locale]/(dashboard)/payroll/pay-plan/page.tsx`.
- Create `src/features/payroll/driver-pay-plan-page-shell.tsx`.
- Modify `src/features/payroll/payroll-page-shell.tsx` (entry link), `src/lib/menu/menu-registry.ts`, `src/features/payroll/driver-pay-plan.test.ts` (schema pinning).

**Phase C — rider calculator (rider repo, GATED on owner approval)**
- Create `lib/features/earnings/pay_calculator_screen.dart`.
- Modify `lib/features/earnings/earnings_service.dart`, `lib/core/router/app_router.dart`, `lib/features/earnings/earnings_screen.dart`, `lib/l10n/app_en.arb`, `lib/l10n/app_ar.arb`.

---

## Phase A — Admin bulk upload

### Task A0: Confirm the read path (no code)

**Files:** none. The checkpoint that proves the counters this upload feeds are already wired.

- [ ] **Step 1: Read the two readers**

```bash
sed -n '275,310p' functions/src/rpcs/driver-home.ts
sed -n '232,290p' functions/src/rpcs/driver-pay.ts
```

Expected: `driver-home.ts` sums `rider_compliance_daily/{driverId}_{day}` over the Kuwait **week** into `week.invalid_days|rejected_orders|cancelled_orders`; `driver-pay.ts` sums the same documents over the **month** into the calculator prefill.

- [ ] **Step 2: Confirm no compliance documents exist yet**

```bash
node scripts/qa-40-probe.mjs
```

Then confirm through the console (or a one-off script) that `rider_compliance_daily` holds **zero** documents. That is why the Home card and the calculator prefill read 0 in production; Tasks A1–A6 are the fix.

- [ ] **Step 3: No commit.** Nothing changed.

---

### Task A1: Pure parse + status resolution

**Files:**
- Create: `src/features/compliance/types.ts`, `src/features/compliance/compliance-parse.ts`
- Test: `src/features/compliance/compliance-parse.test.ts`
- Modify: `package.json` (add the `test:compliance` script)

**Interfaces:**
- Produces:
  - `ComplianceMetricKey = "invalid_days" | "rejected_orders" | "cancelled_orders"`
  - `ComplianceRowStatus = "ok" | "unknown_id" | "ambiguous" | "invalid_day" | "invalid_number" | "duplicate"`
  - `ComplianceSheet = { headers: string[]; rows: string[][] }` — the raw shape the browser sends and the server re-parses
  - `ComplianceSheetIssues = { missingRequiredColumns: string[]; missingOptionalColumns: string[] }`
  - `ComplianceUploadRow = { row_index, employee_id, driver_code, day, invalid_days, rejected_orders, cancelled_orders, status }`
  - `CompliancePreviewRow = ComplianceUploadRow & { driver_id: string | null; driver_name: string | null }`
  - `ComplianceWrite = { id: string; data: Record<string, unknown> }`
  - `COMPLIANCE_REQUIRED_COLUMNS`, `COMPLIANCE_IDENTITY_COLUMNS`, `COMPLIANCE_OPTIONAL_COLUMNS`, `COMPLIANCE_TEMPLATE_HEADERS`, `COMPLIANCE_MAX_ROWS = 5000`
  - `parseComplianceSheet(sheet: ComplianceSheet, options?: { today?: string }): { rows: ComplianceUploadRow[]; issues: ComplianceSheetIssues }`
  - `normalizeCell(value: unknown): string`
  - `dedupeResolvedRows(rows: CompliancePreviewRow[]): { rows: CompliancePreviewRow[]; duplicateCount: number }`
  - `buildComplianceWrites(rows: CompliancePreviewRow[], meta: { batchId: string; fileName: string; uploadedBy: string; uploadedAt: Date }): ComplianceWrite[]`

- [ ] **Step 1: Write the failing test**

Create `src/features/compliance/compliance-parse.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPLIANCE_MAX_ROWS,
  buildComplianceWrites,
  commitComplianceWrites,
  dedupeResolvedRows,
  parseComplianceSheet,
} from "./compliance-parse";
import type { CompliancePreviewRow, ComplianceWrite } from "./types";

const HEADERS = [
  "employee_id",
  "driver_code",
  "day",
  "invalid_days",
  "rejected_orders",
  "cancelled_orders",
];

describe("parseComplianceSheet", () => {
  it("reads the headers case-insensitively and in any order", () => {
    const { rows, issues } = parseComplianceSheet({
      headers: ["Day", "Employee ID", "Driver Code", "Invalid Days", "Rejected Orders", "Cancelled Orders"],
      rows: [["2026-10-12", "40028", "10955", "2", "3", "1"]],
    });
    assert.deepEqual(issues.missingRequiredColumns, []);
    assert.deepEqual(issues.missingOptionalColumns, []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].employee_id, "40028");
    assert.equal(rows[0].driver_code, "10955");
    assert.equal(rows[0].day, "2026-10-12");
    assert.equal(rows[0].invalid_days, 2);
    assert.equal(rows[0].rejected_orders, 3);
    assert.equal(rows[0].cancelled_orders, 1);
    assert.equal(rows[0].status, "ok");
  });

  it("treats a blank metric as zero and rejects a non-number", () => {
    const { rows } = parseComplianceSheet({
      headers: HEADERS,
      rows: [
        ["40028", "", "2026-10-12", "", "", ""],
        ["40029", "", "2026-10-12", "two", "3", "1"],
      ],
    });
    assert.deepEqual(
      [rows[0].invalid_days, rows[0].rejected_orders, rows[0].cancelled_orders],
      [0, 0, 0],
    );
    assert.equal(rows[1].status, "invalid_number");
  });

  it("flags a bad day, a missing identity and a duplicate rider+day", () => {
    const { rows } = parseComplianceSheet({
      headers: HEADERS,
      rows: [
        ["40028", "", "12-10-2026", "1", "0", "0"],
        ["", "", "2026-10-12", "1", "0", "0"],
        ["40030", "", "2026-10-12", "1", "0", "0"],
        ["40030", "", "2026-10-12", "2", "0", "0"],
      ],
    });
    assert.equal(rows[0].status, "invalid_day");
    assert.equal(rows[1].status, "unknown_id");
    assert.equal(rows[2].status, "ok");
    assert.equal(rows[3].status, "duplicate");
  });

  it("treats an absent optional metric column as zero, not as a refusal", () => {
    const { rows, issues } = parseComplianceSheet({
      headers: ["employee_id", "day"],
      rows: [["40028", "2026-10-12"]],
    });
    assert.deepEqual(issues.missingRequiredColumns, []);
    assert.deepEqual(issues.missingOptionalColumns, [
      "invalid_days",
      "rejected_orders",
      "cancelled_orders",
    ]);
    assert.deepEqual(
      [rows[0].invalid_days, rows[0].rejected_orders, rows[0].cancelled_orders],
      [0, 0, 0],
    );
    assert.equal(rows[0].status, "ok");
  });

  it("blocks a file with no day column", () => {
    const { issues } = parseComplianceSheet({
      headers: ["employee_id", "invalid_days"],
      rows: [["40028", "1"]],
    });
    assert.deepEqual(issues.missingRequiredColumns, ["day"]);
  });

  it("blocks a file with neither identity column", () => {
    const { issues } = parseComplianceSheet({
      headers: ["day", "invalid_days"],
      rows: [["2026-10-12", "1"]],
    });
    assert.deepEqual(issues.missingRequiredColumns, ["employee_id or driver_code"]);
  });

  it("accepts either identity column on its own", () => {
    const byCode = parseComplianceSheet({
      headers: ["driver_code", "day", "invalid_days"],
      rows: [["10955", "2026-10-12", "1"]],
    });
    assert.deepEqual(byCode.issues.missingRequiredColumns, []);
    assert.equal(byCode.rows[0].status, "ok");
  });

  it("normalizes zero-width characters and Arabic-Indic digits", () => {
    const { rows } = parseComplianceSheet({
      headers: ["employee_id", "day", "invalid_days", "rejected_orders", "cancelled_orders"],
      rows: [["\uFEFF 40028 \u200F", "2026-10-12", "٢", "٣", "١"]],
    });
    assert.equal(rows[0].employee_id, "40028");
    assert.equal(rows[0].invalid_days, 2);
    assert.equal(rows[0].rejected_orders, 3);
    assert.equal(rows[0].cancelled_orders, 1);
    assert.equal(rows[0].status, "ok");
  });

  it("caps a file at the row limit", () => {
    const { rows } = parseComplianceSheet({
      headers: HEADERS,
      rows: Array.from({ length: COMPLIANCE_MAX_ROWS + 1 }, (_, i) => [
        `4${String(i).padStart(4, "0")}`,
        "",
        "2026-10-12",
        "1",
        "0",
        "0",
      ]),
    });
    assert.equal(rows.length, COMPLIANCE_MAX_ROWS);
  });
});

function previewRow(over: Partial<CompliancePreviewRow>): CompliancePreviewRow {
  return {
    row_index: 0,
    employee_id: "",
    driver_code: "",
    day: "2026-10-12",
    invalid_days: 0,
    rejected_orders: 0,
    cancelled_orders: 0,
    status: "ok",
    driver_id: "d1",
    driver_name: "Ali",
    ...over,
  };
}

describe("dedupeResolvedRows", () => {
  it("catches the same rider-day typed through different id columns", () => {
    const { rows, duplicateCount } = dedupeResolvedRows([
      previewRow({ row_index: 0, employee_id: "40028", driver_id: "d1" }),
      previewRow({ row_index: 1, driver_code: "10955", driver_id: "d1" }),
    ]);
    assert.equal(duplicateCount, 1);
    assert.equal(rows[0].status, "ok");
    assert.equal(rows[1].status, "duplicate");
  });

  it("keeps two different days for one rider", () => {
    const { rows, duplicateCount } = dedupeResolvedRows([
      previewRow({ row_index: 0, employee_id: "40028" }),
      previewRow({ row_index: 1, employee_id: "40028", day: "2026-10-13" }),
    ]);
    assert.equal(duplicateCount, 0);
    assert.equal(rows[1].status, "ok");
  });

  it("never re-labels a row the parser already rejected", () => {
    const { rows, duplicateCount } = dedupeResolvedRows([
      previewRow({ row_index: 0, employee_id: "40028" }),
      previewRow({ row_index: 1, employee_id: "40028", status: "unknown_id", driver_id: null }),
    ]);
    assert.equal(duplicateCount, 0);
    assert.equal(rows[1].status, "unknown_id");
  });
});

describe("buildComplianceWrites", () => {
  it("keys every write by resolved driver and Kuwait day, and skips rejects", () => {
    const uploadedAt = new Date("2026-10-16T00:00:00Z");
    const writes = buildComplianceWrites(
      [
        previewRow({
          row_index: 0,
          employee_id: "40028",
          driver_code: "10955",
          driver_id: "d1",
          invalid_days: 1,
          rejected_orders: 2,
          cancelled_orders: 3,
        }),
        previewRow({ row_index: 1, driver_id: "d2", status: "duplicate" }),
      ],
      { batchId: "b1", fileName: "ops.csv", uploadedBy: "u1", uploadedAt },
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].id, "d1_2026-10-12");
    assert.deepEqual(writes[0].data, {
      driver_id: "d1",
      employee_id: "40028",
      driver_code: "10955",
      day: "2026-10-12",
      invalid_days: 1,
      rejected_orders: 2,
      cancelled_orders: 3,
      source: "ops_upload",
      batch_id: "b1",
      file_name: "ops.csv",
      uploaded_by: "u1",
      uploaded_at: uploadedAt,
    });
  });
});

describe("commitComplianceWrites", () => {
  const write = (id: string): ComplianceWrite => ({ id, data: { id } });

  it("reports the chunks that committed when a later chunk fails", async () => {
    const attempted: string[][] = [];
    const { committed, failure } = await commitComplianceWrites(
      [write("a"), write("b"), write("c")],
      async (chunk) => {
        attempted.push(chunk.map((item) => item.id));
        if (chunk[0].id === "c") throw new Error("boom");
      },
      2,
    );
    assert.deepEqual(attempted, [["a", "b"], ["c"]]);
    assert.deepEqual(
      committed.map((item) => item.id),
      ["a", "b"],
    );
    assert.ok(failure instanceof Error);
  });

  it("reports nothing committed when the first chunk fails", async () => {
    const { committed, failure } = await commitComplianceWrites(
      [write("a")],
      async () => {
        throw new Error("boom");
      },
      2,
    );
    assert.deepEqual(committed, []);
    assert.ok(failure instanceof Error);
  });

  it("reports no failure when every chunk commits", async () => {
    const { committed, failure } = await commitComplianceWrites(
      [write("a"), write("b"), write("c")],
      async () => {},
      2,
    );
    assert.equal(failure, null);
    assert.equal(committed.length, 3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/features/compliance/compliance-parse.test.ts`
Expected: FAIL — `Cannot find module './compliance-parse'`.

- [ ] **Step 3: Write the shared types**

Create `src/features/compliance/types.ts`:

```ts
export const COMPLIANCE_METRIC_KEYS = [
  "invalid_days",
  "rejected_orders",
  "cancelled_orders",
] as const;

export type ComplianceMetricKey = (typeof COMPLIANCE_METRIC_KEYS)[number];

export type ComplianceRowStatus =
  | "ok"
  | "unknown_id"
  | "ambiguous"
  | "invalid_day"
  | "invalid_number"
  | "duplicate";

export type ComplianceUploadRow = {
  row_index: number;
  employee_id: string;
  driver_code: string;
  day: string;
  invalid_days: number;
  rejected_orders: number;
  cancelled_orders: number;
  status: ComplianceRowStatus;
};

/** Raw sheet as the browser sends it. Cells are untrusted strings. */
export type ComplianceSheet = {
  headers: string[];
  rows: string[][];
};

export type ComplianceSheetIssues = {
  /** Non-empty ⇒ the file must not be applied. */
  missingRequiredColumns: string[];
  /** Recorded and shown; absent metrics count as zero. */
  missingOptionalColumns: string[];
};

/** One document to write, already keyed and shaped. */
export type ComplianceWrite = {
  id: string;
  data: Record<string, unknown>;
};

/** One live rider indexed by both identities. */
export type CompliancePreviewRow = ComplianceUploadRow & {
  driver_id: string | null;
  driver_name: string | null;
};

export type CompliancePreview = {
  rows: CompliancePreviewRow[];
  issues: ComplianceSheetIssues;
  statusCounts: Record<ComplianceRowStatus, number>;
};

export type CompliancePreviewResult =
  | { preview: CompliancePreview }
  | { error: "not_authorized" | "lookup_failed" };

export type ComplianceApplyResult =
  | {
      success: true;
      totalRows: number;
      writtenRows: number;
      driverCount: number;
      notifiedDrivers: number;
      statusCounts: Record<ComplianceRowStatus, number>;
    }
  | {
      error:
        | "not_authorized"
        | "not_configured"
        | "missing_columns"
        | "no_rows"
        | "write_failed"
        | "partial_write";
      /** Populated on `missing_columns`: what the file had to carry. */
      missingRequiredColumns?: string[];
      /** Populated on `partial_write`: rows that committed before the failure. */
      writtenRows?: number;
      driverCount?: number;
      notifiedDrivers?: number;
      statusCounts?: Record<ComplianceRowStatus, number>;
      errorDetail?: string;
    };
```

- [ ] **Step 4: Write the parser**

Create `src/features/compliance/compliance-parse.ts`:

```ts
import {
  COMPLIANCE_METRIC_KEYS,
  type ComplianceMetricKey,
  type CompliancePreviewRow,
  type ComplianceRowStatus,
  type ComplianceUploadRow,
  type ComplianceWrite,
} from "./types";

/** Ops reconcile the current month; one file beyond this is a mistake, not an upload. */
export const COMPLIANCE_MAX_ROWS = 5000;

/** Firestore caps a WriteBatch at 500; 400 leaves headroom for the audit write. */
export const COMPLIANCE_WRITE_CHUNK = 400;

export const COMPLIANCE_REQUIRED_COLUMNS = ["day"] as const;
export const COMPLIANCE_IDENTITY_COLUMNS = ["employee_id", "driver_code"] as const;
export const COMPLIANCE_OPTIONAL_COLUMNS = COMPLIANCE_METRIC_KEYS;

/** The CSV template, in the order the download writes it. */
export const COMPLIANCE_TEMPLATE_HEADERS = [
  ...COMPLIANCE_IDENTITY_COLUMNS,
  ...COMPLIANCE_REQUIRED_COLUMNS,
  ...COMPLIANCE_OPTIONAL_COLUMNS,
] as const;

const MAX_METRIC: Record<ComplianceMetricKey, number> = {
  invalid_days: 31,
  rejected_orders: 9999,
  cancelled_orders: 9999,
};

/**
 * Asia/Kuwait is a fixed +03:00 with no DST, so the day string is arithmetic
 * rather than a timezone database lookup. Mirrors `kuwaitDayString` in
 * functions/src/core/kuwait.ts — the two must agree or the writer and the
 * reader name different documents.
 */
export function kuwaitDayString(nowMs: number = Date.now()): string {
  return new Date(nowMs + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** `2026-10-12` → true. Kuwait day strings are plain dates, never instants. */
export function isComplianceDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeHeader(value: string): string {
  return normalizeCell(value).toLowerCase().replace(/[\s-]+/g, "_");
}

const ZERO_WIDTH = /[\u200B-\u200D\u200E\u200F\u202A-\u202E\uFEFF]/g;
const ARABIC_INDIC = /[\u0660-\u0669\u06F0-\u06F9]/g;

/**
 * Kuwaiti Excel exports arrive with Arabic-Indic digits, and a copy-paste from a
 * chat app arrives with zero-width joiners glued to an id. Both would parse as a
 * non-number or an unknown rider if taken literally, so the server folds them
 * before anything else looks at a cell. This is the only normalisation pass —
 * every reader downstream sees the same string.
 */
export function normalizeCell(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(ZERO_WIDTH, "")
    .replace(ARABIC_INDIC, (digit) => {
      const code = digit.codePointAt(0) ?? 0;
      const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
      return String(code - base);
    })
    .replace(/\u00A0/g, " ")
    .trim();
}

/** A blank cell is a deliberate zero; anything else must parse to a whole number. */
function numberOrNull(value: string): number | null {
  if (value === "") return 0;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function statusOf(input: {
  employee_id: string;
  driver_code: string;
  day: string;
  metrics: Record<ComplianceMetricKey, number>;
  seen: Set<string>;
  today: string;
}): ComplianceRowStatus {
  if (!input.employee_id && !input.driver_code) return "unknown_id";
  if (!isComplianceDay(input.day) || input.day > input.today) return "invalid_day";
  for (const key of COMPLIANCE_METRIC_KEYS) {
    const value = input.metrics[key];
    if (!Number.isInteger(value) || value < 0 || value > MAX_METRIC[key]) {
      return "invalid_number";
    }
  }
  // Identity is whichever id the row carries; a row with both is keyed on the AM
  // id, which is the one ops quotes.
  const identity = input.employee_id || input.driver_code;
  if (input.seen.has(`${identity}|${input.day}`)) return "duplicate";
  return "ok";
}

export function parseComplianceSheet(
  sheet: ComplianceSheet,
  options?: { today?: string },
): { rows: ComplianceUploadRow[]; issues: ComplianceSheetIssues } {
  const today = options?.today ?? kuwaitDayString();

  const indexByHeader = new Map<string, number>();
  sheet.headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !indexByHeader.has(key)) indexByHeader.set(key, index);
  });

  // A required column is blocking; an optional one is merely recorded. `day` and
  // at least one identity column are what make a row addressable at all.
  const missingOptionalColumns = COMPLIANCE_OPTIONAL_COLUMNS.filter(
    (column) => !indexByHeader.has(column),
  ) as string[];
  const missingRequiredColumns: string[] = [];
  if (!indexByHeader.has("day")) missingRequiredColumns.push("day");
  if (!COMPLIANCE_IDENTITY_COLUMNS.some((column) => indexByHeader.has(column))) {
    missingRequiredColumns.push("employee_id or driver_code");
  }

  const seen = new Set<string>();
  const rows = sheet.rows.slice(0, COMPLIANCE_MAX_ROWS).map((cells, rowIndex) => {
    const at = (column: string): string => {
      const index = indexByHeader.get(column);
      return index === undefined ? "" : normalizeCell(cells[index]);
    };

    const parsed: Record<ComplianceMetricKey, number | null> = {
      invalid_days: null,
      rejected_orders: null,
      cancelled_orders: null,
    };
    for (const key of COMPLIANCE_METRIC_KEYS) parsed[key] = numberOrNull(at(key));

    // A failed number still has to become a number for the row type to hold; the
    // status is what stops it being written, so 0 here is inert.
    const metrics = Object.fromEntries(
      COMPLIANCE_METRIC_KEYS.map((key) => [key, parsed[key] ?? 0]),
    ) as Record<ComplianceMetricKey, number>;

    const employeeId = at("employee_id");
    const driverCode = at("driver_code");
    const day = at("day");
    const status = statusOf({
      employee_id: employeeId,
      driver_code: driverCode,
      day,
      metrics,
      seen,
      today,
    });
    if (status === "ok") seen.add(`${employeeId || driverCode}|${day}`);

    return {
      row_index: rowIndex,
      employee_id: employeeId,
      driver_code: driverCode,
      day,
      ...metrics,
      status,
    } satisfies ComplianceUploadRow;
  });

  return { rows, issues: { missingRequiredColumns, missingOptionalColumns } };
}

/**
 * Collapse rows that resolve to the same rider-day.
 *
 * The parser can only dedupe on the identity as typed. Two rows — one carrying
 * the AM id, the other the MG id, both belonging to one rider — pass it, and only
 * after resolution is the pair visible. First occurrence wins, so a corrected
 * second row is *rejected* rather than silently winning: an operator who meant to
 * fix a value must re-upload the day, which overwrites it deliberately.
 *
 * Rows the parser already rejected are left exactly as they were.
 */
export function dedupeResolvedRows(rows: CompliancePreviewRow[]): {
  rows: CompliancePreviewRow[];
  duplicateCount: number;
} {
  const seen = new Set<string>();
  let duplicateCount = 0;
  const deduped = rows.map((row) => {
    if (row.status !== "ok" || !row.driver_id) return row;
    const key = `${row.driver_id}|${row.day}`;
    if (seen.has(key)) {
      duplicateCount += 1;
      return { ...row, status: "duplicate" as ComplianceRowStatus };
    }
    seen.add(key);
    return row;
  });
  return { rows: deduped, duplicateCount };
}

/**
 * The single write builder. Both the server action and the emulator check call
 * this, so the document the emulator proves is byte-for-byte the document the
 * action writes — there is no second place the shape can drift.
 *
 * `id` is `{driverId}_{day}`, the key both readers sum. `uploaded_at` is a Date,
 * which the Admin SDK stores as a timestamp.
 */
export function buildComplianceWrites(
  rows: CompliancePreviewRow[],
  meta: { batchId: string; fileName: string; uploadedBy: string; uploadedAt: Date },
): ComplianceWrite[] {
  return rows
    .filter((row) => row.status === "ok" && row.driver_id)
    .map((row) => ({
      id: `${row.driver_id}_${row.day}`,
      data: {
        driver_id: row.driver_id,
        employee_id: row.employee_id || null,
        driver_code: row.driver_code || null,
        day: row.day,
        invalid_days: row.invalid_days,
        rejected_orders: row.rejected_orders,
        cancelled_orders: row.cancelled_orders,
        source: "ops_upload",
        batch_id: meta.batchId,
        file_name: meta.fileName,
        uploaded_by: meta.uploadedBy,
        uploaded_at: meta.uploadedAt,
      },
    }));
}

/**
 * Commit the planned writes in chunks, and report exactly how far it got.
 *
 * The commit function is injected so this ordering rule is testable without a
 * database: a chunk that throws after an earlier chunk committed must leave the
 * earlier chunk counted, because the caller reports that number to an operator who
 * is about to decide whether to re-upload. Getting this wrong is the difference
 * between "nothing was written" and a silent overwrite of half a day's data.
 */
export async function commitComplianceWrites(
  writes: ComplianceWrite[],
  commitChunk: (chunk: ComplianceWrite[]) => Promise<void>,
  chunkSize: number = COMPLIANCE_WRITE_CHUNK,
): Promise<{ committed: ComplianceWrite[]; failure: unknown | null }> {
  const committed: ComplianceWrite[] = [];
  for (let i = 0; i < writes.length; i += chunkSize) {
    const chunk = writes.slice(i, i + chunkSize);
    try {
      await commitChunk(chunk);
      committed.push(...chunk);
    } catch (error) {
      return { committed, failure: error };
    }
  }
  return { committed, failure: null };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test src/features/compliance/compliance-parse.test.ts`
Expected: PASS — 16 tests: 9 in `parseComplianceSheet` (header order/case, blank-vs-bad metric, bad day + identity + duplicate, optional-column tolerance, no `day`, no identity pair, either identity alone, Arabic-Indic and zero-width normalisation, the row cap), 3 in `dedupeResolvedRows`, 1 in `buildComplianceWrites`, 3 in `commitComplianceWrites`. Count them rather than trusting the total: a suite that silently collected zero tests also prints "pass".

- [ ] **Step 6: Wire the suite into package.json**

In `package.json`, in `scripts`, add after `"test:requests"`:

```json
    "test:compliance": "node --import tsx --test src/features/compliance/compliance-parse.test.ts",
```

Run: `npm run test:compliance`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/compliance package.json
git commit -m "Add the compliance upload parser, dedupe and write builder"
```

---


---

### Task A2: Preview + apply server actions

**Files:**
- Create: `src/features/compliance/compliance-upload-actions.ts`
- Modify: `src/lib/firebase/db.ts` (one collection name)

**Interfaces:**
- Consumes: `parseComplianceSheet`, `dedupeResolvedRows`, `buildComplianceWrites` (Task A1); `resolveDriversByLookupIds(clientOrIds: unknown, lookupIds?: string[]): Promise<ResolvedDriverLookup[]>` and `decideImportRowMatch({ employeeId, driverCode, byEmployee, byCode })` / `lookupToImportMatch(r)` from `@/features/drivers/*`; `requireMutationAuth(slug)`, `getSessionUser()`, `hasPermissionInSet()`, `staffDb()`, `callAdminFunction<T>(rpc, args)`, `logAdminMutation({...})`.
- Produces:
  - `resolveComplianceRows(rows: ComplianceUploadRow[]): Promise<{ rows: CompliancePreviewRow[]; statusCounts: Record<ComplianceRowStatus, number> }>` — resolves **and** dedupes
  - `resolveComplianceSheet(sheet: ComplianceSheet): Promise<{ rows: CompliancePreviewRow[]; issues: ComplianceSheetIssues; statusCounts: Record<ComplianceRowStatus, number> }>`
  - `previewRiderComplianceUpload(input: { sheet: ComplianceSheet }): Promise<CompliancePreviewResult>`
  - `applyRiderComplianceUpload(input: { locale: string; fileName: string; sheet: ComplianceSheet }): Promise<ComplianceApplyResult>`

**Trust boundary:** both actions take the raw `ComplianceSheet` and nothing else. They never accept a status, a metric or a `driver_id` from the caller — a client that posts `status: "ok"` and `invalid_days: 0` for every row changes nothing, because the server re-parses the sheet and recomputes all of it.

- [ ] **Step 1: Register the collection name**

In `src/lib/firebase/db.ts`, add to `COLLECTIONS` next to `driverEarningsDaily`:

```ts
  /** Operations-uploaded Invalid / Rejected / Cancelled rows, keyed `{driverId}_{day}`. */
  riderComplianceDaily: "rider_compliance_daily",
```

The string must match `functions/src/core/collections.ts:56` exactly, or the writer and the readers name different collections. No `firestore.rules` change is needed: both sides use the Admin SDK, and no client reads this collection.

- [ ] **Step 2: Write the resolver and the preview action**

Create `src/features/compliance/compliance-upload-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { resolveDriversByLookupIds } from "@/features/drivers/resolve-drivers-by-lookup-ids";
import {
  decideImportRowMatch,
  lookupToImportMatch,
} from "@/features/drivers/resolve-import-row";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  buildComplianceWrites,
  commitComplianceWrites,
  dedupeResolvedRows,
  parseComplianceSheet,
} from "./compliance-parse";
import type {
  ComplianceApplyResult,
  CompliancePreviewResult,
  CompliancePreviewRow,
  ComplianceRowStatus,
  ComplianceSheet,
  ComplianceSheetIssues,
  ComplianceUploadRow,
} from "./types";

/** `MAX_REFRESH_DRIVERS` in functions/src/rpcs/driver-pay.ts. */
const NOTIFY_CHUNK = 500;

const EMPTY_STATUS_COUNTS: Record<ComplianceRowStatus, number> = {
  ok: 0,
  unknown_id: 0,
  ambiguous: 0,
  invalid_day: 0,
  invalid_number: 0,
  duplicate: 0,
};

function countStatuses(
  rows: Array<{ status: ComplianceRowStatus }>,
): Record<ComplianceRowStatus, number> {
  const counts = { ...EMPTY_STATUS_COUNTS };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/**
 * Attach a rider to every parsed row.
 *
 * Only rows the parser already accepted are looked up: a row with a bad day or a
 * bad number is rejected on its own merits and never gets a second life here. A
 * blocked or archived rider is reported and skipped rather than written — their
 * app cannot paint the card, so a document would be invisible data.
 */
export async function resolveComplianceRows(rows: ComplianceUploadRow[]): Promise<{
  rows: CompliancePreviewRow[];
  statusCounts: Record<ComplianceRowStatus, number>;
}> {
  const parserOk = rows.filter((row) => row.status === "ok");
  const lookups = [
    ...new Set(
      parserOk.flatMap((row) => [row.employee_id, row.driver_code].filter(Boolean)),
    ),
  ];

  const resolved = lookups.length > 0 ? await resolveDriversByLookupIds(lookups) : [];
  const byLookup = new Map(resolved.map((row) => [row.lookup_id, row]));

  const preview: CompliancePreviewRow[] = rows.map((row) => {
    if (row.status !== "ok") {
      return { ...row, driver_id: null, driver_name: null };
    }
    const match = (lookupId: string) => {
      const found = byLookup.get(lookupId);
      return found ? lookupToImportMatch(found) : null;
    };
    const decided = decideImportRowMatch({
      employeeId: row.employee_id,
      driverCode: row.driver_code,
      byEmployee: match(row.employee_id),
      byCode: match(row.driver_code),
    });
    const status: ComplianceRowStatus =
      decided.status === "ok"
        ? "ok"
        : decided.status === "ambiguous"
          ? "ambiguous"
          : "unknown_id";
    return {
      ...row,
      status,
      driver_id: status === "ok" ? (decided.driver?.driver_id ?? null) : null,
      driver_name: decided.driver?.full_name ?? null,
    };
  });

  // Dedupe only after resolution: the parser cannot see that `40028` and `10955`
  // are one rider, so the cross-column duplicate is caught here or nowhere.
  const { rows } = dedupeResolvedRows(preview);
  return { rows, statusCounts: countStatuses(rows) };
}

/** Re-parse a raw sheet server-side, then resolve it. Both actions go through this. */
export async function resolveComplianceSheet(sheet: ComplianceSheet): Promise<{
  rows: CompliancePreviewRow[];
  issues: ComplianceSheetIssues;
  statusCounts: Record<ComplianceRowStatus, number>;
}> {
  const parsed = parseComplianceSheet(sheet);
  const resolved = await resolveComplianceRows(parsed.rows);
  return {
    rows: resolved.rows,
    issues: parsed.issues,
    statusCounts: resolved.statusCounts,
  };
}

export async function previewRiderComplianceUpload(input: {
  sheet: ComplianceSheet;
}): Promise<CompliancePreviewResult> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "compliance.view", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" };
  }
  try {
    const { rows, issues, statusCounts } = await resolveComplianceSheet(input.sheet);
    return { preview: { rows, issues, statusCounts } };
  } catch {
    // A roster read that failed must not render as "every rider is unknown".
    return { error: "lookup_failed" };
  }
}
```

- [ ] **Step 3: Write the apply action**

Append to `src/features/compliance/compliance-upload-actions.ts`:

```ts
/**
 * Write one document per rider-day, then ping the riders whose numbers changed.
 *
 * The write is authoritative and the push is best-effort: a failed refresh call
 * leaves correct data the app picks up on its next cold read, so it is logged and
 * not thrown. Re-uploading a day overwrites that day (`set` with merge on the
 * same `{driverId}_{day}` id), which is what makes a corrected file idempotent.
 */
export async function applyRiderComplianceUpload(input: {
  locale: string;
  fileName: string;
  sheet: ComplianceSheet;
}): Promise<ComplianceApplyResult> {
  const auth = await requireMutationAuth("compliance.manage");
  if ("error" in auth) {
    return {
      error: auth.error === "not_configured" ? "not_configured" : "not_authorized",
    };
  }

  const db = await staffDb();
  if (!db) return { error: "not_configured" };

  // Nothing the caller asserted about a row survives this call: the sheet is
  // re-parsed and re-resolved here, and only this result is written.
  let resolved: Awaited<ReturnType<typeof resolveComplianceSheet>>;
  try {
    resolved = await resolveComplianceSheet(input.sheet);
  } catch (error) {
    // Reached before any write, so "nothing was written" is literally true here.
    return {
      error: "write_failed",
      errorDetail: error instanceof Error ? error.message : String(error),
    };
  }

  if (resolved.issues.missingRequiredColumns.length > 0) {
    return {
      error: "missing_columns",
      missingRequiredColumns: resolved.issues.missingRequiredColumns,
      statusCounts: resolved.statusCounts,
    };
  }

  const writable = resolved.rows.filter((row) => row.status === "ok" && row.driver_id);
  if (writable.length === 0) {
    return { error: "no_rows", statusCounts: resolved.statusCounts };
  }

  const batchId = `${Date.now()}_${auth.session.id}`;
  const fileName = input.fileName.slice(0, 160);
  const writes = buildComplianceWrites(writable, {
    batchId,
    fileName,
    uploadedBy: auth.session.id,
    uploadedAt: new Date(),
  });

  const collection = db.collection(COLLECTIONS.riderComplianceDaily);

  // Chunk ordering and the "how far did it get" accounting both live in
  // `commitComplianceWrites`, which carries its own tests. Reporting "nothing was
  // written" after a chunk already committed is the failure mode that function
  // exists to prevent.
  const { committed, failure } = await commitComplianceWrites(writes, async (chunk) => {
    const batch = db.batch();
    for (const write of chunk) {
      // Merge, not create: a corrected re-upload of the same rider-day has to
      // overwrite that day, not leave a second document for the readers to sum.
      batch.set(collection.doc(write.id), write.data, { merge: true });
    }
    await batch.commit();
  });

  // The refresh runs for whatever committed, success or partial. A rider whose
  // numbers did change must not be left on a stale week card because a later chunk
  // failed.
  const driverIds = [...new Set(committed.map((write) => write.data.driver_id as string))];
  const notifiedDrivers = await notifyComplianceRefresh(driverIds);

  const days = committed.map((write) => write.data.day as string).sort();
  void logAdminMutation({
    // `AdminActivityAction` has no "import": a batch that creates rider-day
    // documents is a create. A partial write is logged as a failure with the real
    // counts, so the audit trail matches what the operator was told.
    action: "create",
    entityType: "rider_compliance_daily",
    entityId: batchId,
    routeName: "applyRiderComplianceUpload",
    success: failure === null,
    errorMessage: failure instanceof Error ? failure.message : undefined,
    after: {
      file_name: fileName,
      planned_rows: writes.length,
      written_rows: committed.length,
      drivers: driverIds.length,
      first_day: days[0],
      last_day: days[days.length - 1],
    },
  });

  if (failure) {
    return {
      error: "partial_write",
      writtenRows: committed.length,
      driverCount: driverIds.length,
      notifiedDrivers,
      statusCounts: resolved.statusCounts,
      errorDetail: failure instanceof Error ? failure.message : String(failure),
    };
  }

  revalidatePath(`/${input.locale}/compliance`, "page");

  return {
    success: true,
    totalRows: resolved.rows.length,
    writtenRows: committed.length,
    driverCount: driverIds.length,
    notifiedDrivers,
    statusCounts: resolved.statusCounts,
  };
}

/**
 * Ping the riders whose numbers changed.
 *
 * Best-effort by design: the documents are authoritative and the push only makes an
 * open app repaint sooner, so a failed call is logged rather than thrown — a 500
 * from FCM must not turn a committed upload into an error the operator retries.
 */
async function notifyComplianceRefresh(driverIds: string[]): Promise<number> {
  let notified = 0;
  for (let i = 0; i < driverIds.length; i += NOTIFY_CHUNK) {
    const chunk = driverIds.slice(i, i + NOTIFY_CHUNK);
    const { error } = await callAdminFunction("admin_notify_compliance_refresh", {
      driver_ids: chunk,
    });
    if (error) {
      console.error(
        `[compliance-upload] refresh failed for ${chunk.length} drivers: ${error.message}`,
      );
      continue;
    }
    notified += chunk.length;
  }
  return notified;
}
```

- [ ] **Step 4: Typecheck and run the auth-coverage scan**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors in `src/features/compliance/*`.

Run: `node --import tsx --test src/lib/auth/mutation-auth-coverage.test.ts`
Expected: PASS. This test is **not** wired into any `package.json` script today (checked: `test:permissions` and `test:auth` do not include it), so it only runs when named. It scans every server action that calls a mutating RPC and requires the function to be gated — `applyRiderComplianceUpload` passes because `requireMutationAuth("compliance.manage")` is its first statement. If it fails here, the gate is missing or has been moved below an early return.

- [ ] **Step 5: Commit**

```bash
git add src/features/compliance src/lib/firebase/db.ts
git commit -m "Add the compliance upload server actions"
```

---

### Task A3: The upload page shell

**Files:**
- Create: `src/features/compliance/rider-compliance-upload-shell.tsx`

**Interfaces:**
- Consumes: `parseSpreadsheetFile(file)` → `{ headers, rows, headerSignature }` from `@/lib/import/spreadsheet`; `parseComplianceSheet`, `kuwaitDayString` (Task A1); `previewRiderComplianceUpload`, `applyRiderComplianceUpload` (Task A2); `AppPage`, `AppPageHeader`, `AppListCard`, `AppModalFooter`, `StatusPill`, `Table*`.
- Produces: `RiderComplianceUploadShell()` — the client component the route renders (Task A5).

- [ ] **Step 1: Write the state, the file picker and the preview call**

Create `src/features/compliance/rider-compliance-upload-shell.tsx`:

```tsx
"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseSpreadsheetFile } from "@/lib/import/spreadsheet";
import {
  COMPLIANCE_MAX_ROWS,
  COMPLIANCE_TEMPLATE_HEADERS,
  kuwaitDayString,
} from "./compliance-parse";
import {
  applyRiderComplianceUpload,
  previewRiderComplianceUpload,
} from "./compliance-upload-actions";
import type { CompliancePreview, ComplianceRowStatus, ComplianceSheet } from "./types";

/** Preview renders this many rows; the rest are counted, not drawn. */
const PREVIEW_LIMIT = 100;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function RiderComplianceUploadShell() {
  const t = useTranslations("pages.compliance");
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [applying, startApply] = useTransition();
  const [fileName, setFileName] = useState("");
  // The raw sheet, exactly as read from the file. It is what the server re-parses,
  // so the client keeps no derived rows of its own: the preview it renders comes
  // back from the server, statuses included.
  const [sheet, setSheet] = useState<ComplianceSheet | null>(null);
  const [preview, setPreview] = useState<CompliancePreview | null>(null);
  const [ready, setReady] = useState(false);

  const okRows = useMemo(
    () => (preview ? preview.rows.filter((row) => row.status === "ok") : []),
    [preview],
  );
  const rejectedRows = useMemo(
    () => (preview ? preview.rows.filter((row) => row.status !== "ok") : []),
    [preview],
  );

  const downloadTemplate = () => {
    const rows = [
      COMPLIANCE_TEMPLATE_HEADERS.join(","),
      `40028,10955,${kuwaitDayString()},0,0,0`,
    ].join("\n");
    const blob = new Blob([`${rows}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rider-compliance-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportRejected = () => {
    const header = `${COMPLIANCE_TEMPLATE_HEADERS.join(",")},status`;
    const body = rejectedRows
      .map((row) =>
        [
          row.employee_id,
          row.driver_code,
          row.day,
          row.invalid_days,
          row.rejected_orders,
          row.cancelled_orders,
          row.status,
        ].join(","),
      )
      .join("\n");
    const blob = new Blob([`${header}\n${body}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rider-compliance-rejected.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setSheet(null);
    setPreview(null);
    setReady(false);
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const onPicked = (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error(t("fileTooLarge"));
      return;
    }
    startTransition(async () => {
      try {
        const parsedFile = await parseSpreadsheetFile(file);
        if (parsedFile.rows.length === 0) {
          toast.error(t("parseFailed"));
          reset();
          return;
        }
        // The file is sent as-is; the server decides every status, and its answer is
        // the only preview rendered.
        const fileSheet: ComplianceSheet = {
          headers: parsedFile.headers,
          rows: parsedFile.rows,
        };
        setFileName(file.name);
        setSheet(fileSheet);
        setPreview(null);
        setReady(false);

        const result = await previewRiderComplianceUpload({ sheet: fileSheet });
        if ("error" in result) {
          toast.error(result.error === "lookup_failed" ? t("lookupFailed") : t("notAuthorized"));
          return;
        }
        setPreview(result.preview);
        setReady(true);
      } catch {
        toast.error(t("parseFailed"));
      }
    });
  };

  /** Literal `t()` calls per branch keep next-intl's typed keys happy. */
  const statusPill = (status: ComplianceRowStatus) => {
    switch (status) {
      case "ok":
        return <StatusPill variant="success">{t("statusOk")}</StatusPill>;
      case "ambiguous":
        return <StatusPill variant="warning">{t("statusAmbiguous")}</StatusPill>;
      case "duplicate":
        return <StatusPill variant="warning">{t("statusDuplicate")}</StatusPill>;
      case "invalid_day":
        return <StatusPill variant="danger">{t("statusInvalidDay")}</StatusPill>;
      case "invalid_number":
        return <StatusPill variant="danger">{t("statusInvalidNumber")}</StatusPill>;
      default:
        return <StatusPill variant="danger">{t("statusUnknownId")}</StatusPill>;
    }
  };

  const busy = pending || applying;
  const summary = preview?.statusCounts;
  const issues = preview?.issues;
  // A file missing a required column cannot be applied: the button disables here and
  // the server refuses the call as well, so a crafted request cannot bypass it.
  const blocked = (issues?.missingRequiredColumns.length ?? 0) > 0;

  const onApply = () => {
    if (!sheet || !preview || blocked || okRows.length === 0) return;
    startApply(async () => {
      const result = await applyRiderComplianceUpload({ locale, fileName, sheet });
      if ("error" in result) {
        if (result.error === "partial_write") {
          // Say what actually happened. An earlier batch is already committed and
          // those riders have been refreshed; claiming otherwise would send the
          // operator looking for a problem that is not there.
          toast.error(
            t("partialWrite", {
              rows: result.writtenRows ?? 0,
              riders: result.driverCount ?? 0,
            }),
          );
          return;
        }
        toast.error(
          result.error === "no_rows"
            ? t("noWritableRows")
            : result.error === "missing_columns"
              ? t("blockedByColumns", {
                  columns: (result.missingRequiredColumns ?? []).join(", "),
                })
              : result.error === "not_authorized"
                ? t("notAuthorized")
                : t("applyFailed"),
        );
        return;
      }
      toast.success(
        t("appliedToast", { rows: result.writtenRows, riders: result.driverCount }),
      );
      reset();
    });
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-2"
              onClick={downloadTemplate}
            >
              <Download className="h-4 w-4" />
              {t("downloadTemplate")}
            </Button>
            <Button
              type="button"
              className="h-9 gap-2"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {t("chooseFile")}
            </Button>
          </>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPicked(file);
          else reset();
        }}
      />

      <AppListCard
        toolbar={<p className="text-xs text-muted-foreground">{t("templateHint")}</p>}
      >
        {!preview ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="max-w-md text-xs text-muted-foreground">{t("emptyHint")}</p>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            {blocked ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {t("blockedByColumns", {
                  columns: (issues?.missingRequiredColumns ?? []).join(", "),
                })}
              </div>
            ) : null}
            {(issues?.missingOptionalColumns.length ?? 0) > 0 ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {t("missingOptionalColumns", {
                  columns: (issues?.missingOptionalColumns ?? []).join(", "),
                })}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusPill variant="success">
                {t("countOk", { count: summary?.ok ?? 0 })}
              </StatusPill>
              {summary && summary.ambiguous > 0 ? (
                <StatusPill variant="warning">
                  {t("statusAmbiguous")} · {summary.ambiguous}
                </StatusPill>
              ) : null}
              {summary && summary.unknown_id > 0 ? (
                <StatusPill variant="danger">
                  {t("statusUnknownId")} · {summary.unknown_id}
                </StatusPill>
              ) : null}
              {summary && summary.invalid_day > 0 ? (
                <StatusPill variant="danger">
                  {t("statusInvalidDay")} · {summary.invalid_day}
                </StatusPill>
              ) : null}
              {summary && summary.invalid_number > 0 ? (
                <StatusPill variant="danger">
                  {t("statusInvalidNumber")} · {summary.invalid_number}
                </StatusPill>
              ) : null}
              {summary && summary.duplicate > 0 ? (
                <StatusPill variant="warning">
                  {t("statusDuplicate")} · {summary.duplicate}
                </StatusPill>
              ) : null}
              {rejectedRows.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 gap-2 text-xs"
                  onClick={exportRejected}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("exportErrors")}
                </Button>
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>#</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colEmployeeId")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colDriverCode")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colDay")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colInvalidDays")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colRejected")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colCancelled")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.slice(0, PREVIEW_LIMIT).map((row) => (
                    <TableRow key={row.row_index}>
                      <TableCell className="text-xs">{row.row_index + 1}</TableCell>
                      <TableCell className="text-xs">{row.employee_id || "—"}</TableCell>
                      <TableCell className="text-xs">{row.driver_code || "—"}</TableCell>
                      <TableCell className="text-xs">{row.driver_name ?? "—"}</TableCell>
                      <TableCell className="text-xs tabular-nums">{row.day}</TableCell>
                      <TableCell className="text-xs tabular-nums">{row.invalid_days}</TableCell>
                      <TableCell className="text-xs tabular-nums">{row.rejected_orders}</TableCell>
                      <TableCell className="text-xs tabular-nums">{row.cancelled_orders}</TableCell>
                      <TableCell>{statusPill(row.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {preview.rows.length > PREVIEW_LIMIT ? (
              <p className="text-[10px] text-muted-foreground">
                {t("previewTruncated", { shown: PREVIEW_LIMIT, total: preview.rows.length })}
              </p>
            ) : null}
            {sheet && sheet.rows.length >= COMPLIANCE_MAX_ROWS ? (
              <p className="text-[10px] text-muted-foreground">
                {t("rowLimitReached", { max: COMPLIANCE_MAX_ROWS })}
              </p>
            ) : null}
          </div>
        )}
      </AppListCard>

      <AppModalFooter
        asPage
        title={t("applyBarTitle", { rows: okRows.length })}
        subtitle={t("applyBarSubtitle")}
        meta={fileName ? t("applyBarFile", { file: fileName }) : undefined}
      >
        <Button type="button" variant="ghost" className="h-9" disabled={busy} onClick={reset}>
          {t("clear")}
        </Button>
        <Button
          type="button"
          className="h-9 gap-2"
          disabled={!ready || busy || blocked || okRows.length === 0}
          onClick={onApply}
        >
          {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {applying ? t("applying") : t("apply")}
        </Button>
      </AppModalFooter>
    </AppPage>
  );
}
```

- [ ] **Step 2: Typecheck and lint the shell**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. If `t("appliedToast", { rows, riders })` reports a missing key, Task A4 has not run yet — do Task A4 now and rerun.

- [ ] **Step 3: Commit**

```bash
git add src/features/compliance/rider-compliance-upload-shell.tsx
git commit -m "Add the compliance upload page shell"
```

---

### Task A4: Permission, menu entry and cache bump

**Files:**
- Modify: `src/lib/auth/permission-catalog.ts`, `src/lib/menu/menu-registry.ts`, `src/hooks/use-sidebar-menu.ts`

- [ ] **Step 1: Add the two permission slugs**

In `src/lib/auth/permission-catalog.ts`, immediately after the `wrong_actions.manage` entry (line ~210), add:

```ts
  {
    slug: "compliance.view",
    label: "View rider compliance",
    category: "compliance",
  },
  {
    slug: "compliance.manage",
    label: "Upload rider compliance",
    category: "compliance",
  },
```

`compliance.manage` must be spelled exactly this way: the deployed `adminNotifyComplianceRefresh` gates on `["compliance.manage", "drivers.manage"]` (`functions/src/rpcs/driver-pay.ts:304`), and the upload action refuses without it.

- [ ] **Step 2: Register the menu item**

In `src/lib/menu/menu-registry.ts`, after the `wrong-actions` item (line ~578), add:

```ts
  {
    id: "compliance",
    defaultLabel: "Compliance Upload",
    defaultIcon: "ClipboardCheck",
    href: "/compliance",
    defaultGroup: "Operations",
    defaultOrder: 6.5,
    permission: "compliance.view",
  },
```

`defaultIcon` strings resolve against a lucide map; if `ClipboardCheck` is not in it, reuse the icon the `wrong-actions` item already uses.

- [ ] **Step 3: Bump the sidebar cache version**

In `src/hooks/use-sidebar-menu.ts:24`, replace:

```ts
const MENU_CACHE_VERSION = "v31";
```

with:

```ts
const MENU_CACHE_VERSION = "v32";
```

Without the bump, a browser that already cached the sidebar keeps rendering a menu without the new item.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/permission-catalog.ts src/lib/menu/menu-registry.ts src/hooks/use-sidebar-menu.ts
git commit -m "Register the compliance upload page in the menu"
```

---

### Task A5: Copy for the page (EN + AR)

**Files:**
- Modify: `src/messages/en.json`, `src/messages/ar.json`

- [ ] **Step 1: Add the English block**

In `src/messages/en.json`, inside the `pages` object, add a `compliance` block:

```json
"compliance": {
  "title": "Rider Compliance Upload",
  "description": "Upload the Invalid, Rejected and Cancelled rows Operations reconciles for each rider-day. Saved numbers reach the rider's app immediately.",
  "templateHint": "Columns: employee_id, driver_code, day (YYYY-MM-DD), invalid_days, rejected_orders, cancelled_orders. One row per rider per day. A blank metric counts as 0.",
  "downloadTemplate": "Template",
  "chooseFile": "Choose file",
  "emptyTitle": "No file loaded",
  "emptyHint": "Pick a CSV or Excel file with one row per rider per day. Nothing is written until you press Apply.",
  "blockedByColumns": "This file cannot be applied — missing required column(s): {columns}. Add them and upload again.",
  "missingOptionalColumns": "Optional column(s) missing: {columns}. Those metrics are written as 0.",
  "countOk": "{count} rows ready",
  "statusOk": "Ready",
  "statusUnknownId": "Unknown rider",
  "statusAmbiguous": "Ambiguous ID",
  "statusInvalidDay": "Invalid day",
  "statusInvalidNumber": "Invalid number",
  "statusDuplicate": "Duplicate row",
  "exportErrors": "Export rejected rows",
  "colEmployeeId": "AM ID",
  "colDriverCode": "MG ID",
  "colDriver": "Rider",
  "colDay": "Day",
  "colInvalidDays": "Invalid days",
  "colRejected": "Rejected",
  "colCancelled": "Cancelled",
  "colStatus": "Status",
  "previewTruncated": "Showing the first {shown} of {total} rows.",
  "rowLimitReached": "Only the first {max} rows are read.",
  "applyBarTitle": "Apply {rows} rows",
  "applyBarSubtitle": "Existing values for the same rider and day are replaced.",
  "applyBarFile": "File: {file}",
  "clear": "Clear",
  "apply": "Apply upload",
  "applying": "Writing…",
  "appliedToast": "Updated {rows} rider-days for {riders} riders.",
  "applyFailed": "The upload failed before anything was written.",
  "partialWrite": "Saved {rows} rider-days for {riders} riders, then the upload failed. Upload the file again to finish the rest.",
  "noWritableRows": "No row can be written — fix the rejected rows and try again.",
  "notAuthorized": "You do not have permission to upload compliance data.",
  "lookupFailed": "Could not read the rider roster. Try again.",
  "parseFailed": "That file could not be read.",
  "fileTooLarge": "File is larger than 5 MB."
}
```

- [ ] **Step 2: Add the Arabic block**

In `src/messages/ar.json`, inside the `pages` object, add the matching `compliance` block:

```json
"compliance": {
  "title": "رفع بيانات التزام المندوبين",
  "description": "ارفع صفوف الطلبات غير الصالحة والمرفوضة والملغاة التي تُعدّها العمليات لكل مندوب في اليوم. تصل الأرقام المحفوظة إلى تطبيق المندوب فوراً.",
  "templateHint": "الأعمدة: employee_id، driver_code، day (YYYY-MM-DD)، invalid_days، rejected_orders، cancelled_orders. صف واحد لكل مندوب في اليوم. الخانة الفارغة تُحسب صفراً.",
  "downloadTemplate": "القالب",
  "chooseFile": "اختيار ملف",
  "emptyTitle": "لم يتم تحميل أي ملف",
  "emptyHint": "اختر ملف CSV أو Excel يحتوي على صف واحد لكل مندوب في اليوم. لا يتم حفظ أي شيء قبل الضغط على «تطبيق الرفع».",
  "blockedByColumns": "لا يمكن تطبيق هذا الملف — أعمدة مطلوبة مفقودة: {columns}. أضفها ثم ارفع الملف مرة أخرى.",
  "missingOptionalColumns": "أعمدة اختيارية مفقودة: {columns}. تُكتب تلك المقاييس كصفر.",
  "countOk": "{count} صف جاهز",
  "statusOk": "جاهز",
  "statusUnknownId": "مندوب غير معروف",
  "statusAmbiguous": "رقم غير واضح",
  "statusInvalidDay": "تاريخ غير صالح",
  "statusInvalidNumber": "رقم غير صالح",
  "statusDuplicate": "صف مكرر",
  "exportErrors": "تصدير الصفوف المرفوضة",
  "colEmployeeId": "رقم AM",
  "colDriverCode": "رقم MG",
  "colDriver": "المندوب",
  "colDay": "اليوم",
  "colInvalidDays": "أيام غير صالحة",
  "colRejected": "مرفوضة",
  "colCancelled": "ملغاة",
  "colStatus": "الحالة",
  "previewTruncated": "يتم عرض أول {shown} من {total} صفاً.",
  "rowLimitReached": "يتم قراءة أول {max} صف فقط.",
  "applyBarTitle": "تطبيق {rows} صفاً",
  "applyBarSubtitle": "يتم استبدال القيم السابقة لنفس المندوب واليوم.",
  "applyBarFile": "الملف: {file}",
  "clear": "مسح",
  "apply": "تطبيق الرفع",
  "applying": "جارٍ الحفظ…",
  "appliedToast": "تم تحديث {rows} يوم مندوب لعدد {riders} مندوباً.",
  "applyFailed": "فشل الرفع قبل حفظ أي شيء.",
  "partialWrite": "تم حفظ {rows} يوم مندوب لعدد {riders} مندوباً ثم فشل الرفع. ارفع الملف مرة أخرى لإكمال الباقي.",
  "noWritableRows": "لا يوجد صف قابل للحفظ — صحّح الصفوف المرفوضة وحاول مرة أخرى.",
  "notAuthorized": "لا تملك صلاحية رفع بيانات الالتزام.",
  "lookupFailed": "تعذّر قراءة قائمة المندوبين. حاول مرة أخرى.",
  "parseFailed": "تعذّر قراءة الملف.",
  "fileTooLarge": "حجم الملف أكبر من 5 ميجابايت."
}
```

- [ ] **Step 3: Verify both locales carry the same keys**

Run: `node scripts/check-messages.mjs`
Expected: `messages OK`.

- [ ] **Step 4: Commit**

```bash
git add src/messages/en.json src/messages/ar.json
git commit -m "Add compliance upload copy in English and Arabic"
```

---

### Task A6: Route it, then prove it end to end

**Files:**
- Create: `src/app/[locale]/(dashboard)/compliance/page.tsx`

**Interfaces:**
- Consumes: `requirePermission(locale, slug)` from `@/lib/auth/require-permission`; `RiderComplianceUploadShell` (Task A3).

- [ ] **Step 1: Create the route**

Create `src/app/[locale]/(dashboard)/compliance/page.tsx`:

```tsx
import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RiderComplianceUploadShell } from "@/features/compliance/rider-compliance-upload-shell";

export default async function CompliancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "compliance.view");

  return <RiderComplianceUploadShell />;
}
```

- [ ] **Step 2: Tier 1 — offline, no project touched**

Run, in this order:

```bash
npm run test:compliance                     # 16 tests
npx tsc --noEmit -p tsconfig.json           # no errors
npm run lint                                # no errors
node scripts/check-messages.mjs             # messages OK
npm run build                               # route list includes /[locale]/compliance
```

Expected: all five clean. Nothing here reads or writes any Firebase project.

- [ ] **Step 3: Tier 2 — the write plan against a Firestore emulator**

The emulator is a throwaway database on this machine. This tier proves the data-integrity claims (document id, field shape, idempotent overwrite, rejects never written, duplicates across id columns) without a single production byte.

Add an emulator block to `firebase.json` (local only — it is not deployed and does not affect `firebase deploy`):

```json
  "emulators": {
    "firestore": { "port": 8080 },
    "ui": { "enabled": false }
  },
```

- [ ] **Step 4: Write the emulator check**

Create `scripts/compliance-emulator-check.mjs`:

```js
/**
 * Proves the compliance write plan against the Firestore emulator.
 *
 * Run it through `firebase emulators:exec`, which starts the emulator and exports
 * FIRESTORE_EMULATOR_HOST. Driver ids are synthetic and the roster lookup is not
 * involved: this checks the write plan (id, shape, overwrite, reject exclusion),
 * which is the part a bad upload would corrupt.
 */
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  buildComplianceWrites,
  commitComplianceWrites,
  dedupeResolvedRows,
  parseComplianceSheet,
} from "../src/features/compliance/compliance-parse.ts";

const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-compliance" });
const db = getFirestore(app);
const collection = db.collection("rider_compliance_daily");

function commit(chunk) {
  const batch = db.batch();
  for (const write of chunk) batch.set(collection.doc(write.id), write.data, { merge: true });
  return batch.commit();
}

const sheet = {
  headers: [
    "employee_id",
    "driver_code",
    "day",
    "invalid_days",
    "rejected_orders",
    "cancelled_orders",
  ],
  rows: [
    ["40028", "", "2026-10-12", "1", "2", "3"],
    ["", "10955", "2026-10-12", "9", "9", "9"], // same rider, other column → duplicate
    ["", "", "2026-10-12", "5", "5", "5"], // no identity → rejected
    ["40030", "", "12-10-2026", "1", "0", "0"], // bad day → rejected
  ],
};

const parsed = parseComplianceSheet(sheet);
assert.deepEqual(parsed.issues.missingRequiredColumns, []);
assert.equal(parsed.rows.length, 4);

// Rows 0 and 1 both resolve to one rider; the second is the cross-column duplicate.
const resolved = parsed.rows.map((row, index) => ({
  ...row,
  driver_id: index < 2 ? "emu_driver_1" : null,
  driver_name: index < 2 ? "Emulator Rider" : null,
  status: index < 2 ? "ok" : "unknown_id",
}));
const { rows, duplicateCount } = dedupeResolvedRows(resolved);
assert.equal(duplicateCount, 1);
assert.equal(rows[1].status, "duplicate");

const writes = buildComplianceWrites(rows, {
  batchId: "b1",
  fileName: "ops.csv",
  uploadedBy: "emu_user",
  uploadedAt: new Date("2026-10-16T00:00:00Z"),
});
assert.equal(writes.length, 1, "only the first row for a rider-day is written");
assert.equal(writes[0].id, "emu_driver_1_2026-10-12");

const first = await commitComplianceWrites(writes, commit);
assert.equal(first.failure, null);
assert.equal(first.committed.length, 1);

let snapshot = await collection.get();
assert.equal(snapshot.size, 1, "the rejected rows wrote nothing");
assert.equal(snapshot.docs[0].get("invalid_days"), 1);
assert.equal(snapshot.docs[0].get("rejected_orders"), 2);
assert.equal(snapshot.docs[0].get("cancelled_orders"), 3);
assert.equal(snapshot.docs[0].get("source"), "ops_upload");
assert.equal(snapshot.docs[0].get("batch_id"), "b1");
assert.equal(snapshot.docs[0].get("employee_id"), "40028");

// A corrected re-upload of the same rider-day overwrites that day.
const corrected = buildComplianceWrites(
  [{ ...rows[0], invalid_days: 4, rejected_orders: 5, cancelled_orders: 6 }],
  { batchId: "b2", fileName: "ops-2.csv", uploadedBy: "emu_user", uploadedAt: new Date() },
);
const second = await commitComplianceWrites(corrected, commit);
assert.equal(second.failure, null);

snapshot = await collection.get();
assert.equal(snapshot.size, 1, "a re-upload must not create a second document");
assert.equal(snapshot.docs[0].get("invalid_days"), 4);
assert.equal(snapshot.docs[0].get("batch_id"), "b2");

await app.delete();
console.log("compliance emulator check OK");
```

- [ ] **Step 5: Run the emulator check**

```bash
npx firebase emulators:exec --only firestore --project demo-compliance "node --import tsx scripts/compliance-emulator-check.mjs"
```

Expected: `compliance emulator check OK`. The emulator starts, the script asserts id, shape, overwrite and reject exclusion, and the emulator shuts down. If the Admin SDK asks for credentials, the project is not the demo one — `--project demo-*` is what makes it credential-free; do not point this at `musallam-delivery-prod`.

- [ ] **Step 6: Tier 3 — the live run, only with explicit approval**

Everything below writes to a real project. It is **blocked** until the owner confirms, in writing, both the target (a staging project, or production) and the rider-day to be used. Do not proceed on a verbal "go ahead", and do not test with a rider's real day data if a staging project can be provided instead.

Once approved, on the agreed project:

1. If the target is production, granting the two slugs is itself a production write: open Settings → Roles & Permissions, sync the catalog, and grant `compliance.view` + `compliance.manage` to Operations. This is part of the approval, not a step around it.
2. Upload a CSV for one named rider-day — `employee_id,driver_code,day,invalid_days,rejected_orders,cancelled_orders` with `1,2,3`:
   - The preview shows one `Ready` row with the rider's name and the apply bar reads `Apply 1 rows`.
3. Confirm the document: `rider_compliance_daily/{driverId}_{day}` holds `invalid_days: 1`, `rejected_orders: 2`, `cancelled_orders: 3`, `source: "ops_upload"`, `batch_id`, `uploaded_by`, `uploaded_at`.
4. Re-upload the same rider-day with `4,5,6` and confirm the count stays **one** document holding the new numbers (the emulator proved this; this proves the wiring).
5. Re-upload with `16-10-2026` as the day plus one unknown id and one duplicate and confirm the preview shows `invalid_day`, `unknown_id`, `ok`, `duplicate`, the `Ready` count is 1, and only one document exists for that rider-day.
6. **Rollback, and use it:** the test wrote real numbers onto a real rider's day. Restore the previous values (or delete `rider_compliance_daily/{driverId}_{day}` if there was none) and say so in the handoff. An approval to test is not an approval to leave test data behind.
7. Rider-side confirmation, if the rider app is part of the approval: sign in as that rider and check "This Week's Progress", and in Functions → `adminNotifyComplianceRefresh` → Logs check for one invocation with a `driver_ids` array and no `permission-denied` (a denial there means the catalog sync in step 1 did not land).

- [ ] **Step 7: Commit**

```bash
git add "src/app/[locale]/(dashboard)/compliance/page.tsx" firebase.json scripts/compliance-emulator-check.mjs
git commit -m "Add the compliance upload route and emulator check"
```

**Owner checkpoint:** the day column makes the upload daily-granular. If Operations can only produce **monthly** totals, stop here and ask the client — a monthly figure cannot be spread across days, and the week card would need a different document shape (open question 1 in the questions list at the end of this plan).

---

## Phase B — Mount the pay-plan editor

`src/features/payroll/pay-plan-editor.tsx` and `src/features/payroll/pay-plan-actions.ts` already exist, are correct, and are mounted nowhere. `app_settings/1.driver_pay_plan` is unset, so the SOP defaults are in effect but invisible: nobody at MG-GO can see or change the numbers the rider app is being paid on.

### Task B0: Pin the stored pay-plan schema

**Files:**
- Test: `src/features/payroll/driver-pay-plan.test.ts` (exists, already wired into `npm run test:payroll`)

Nothing in this repo asserts the **key names** the plan is stored under, which is how `invalid_ladder` and `invalid_days_ladder` could both be believed at once. This task settles it with a test rather than a comment.

- [ ] **Step 1: Read-only audit**

```bash
grep -rn "invalid_ladder\|invalid_days_ladder\|invalidLadder" \
  src/features/payroll functions/src/rpcs/driver-pay.ts
grep -rn "invalid_ladder\|invalidLadder" ../MGgo-User/MG-GO/lib/features/earnings/pay_plan.dart
```

Expected, and this is the contract:

| place | key |
|---|---|
| `payPlanToFirestore` (admin writer, `driver-pay-plan.ts:225`) | `invalid_ladder` |
| `parseDriverPayPlan` (admin reader, `:197`) | `invalid_ladder`, falls back to `invalidLadder` |
| `driver-pay.ts` (the deployed reader, `:148`) | `invalid_ladder` **only** |
| `pay_plan.dart` (rider reader, `:285`) | `invalid_ladder`, falls back to `invalidLadder` |

`invalid_days_ladder` must not appear anywhere. If it does, stop: something is writing a key the deployed function never reads.

- [ ] **Step 2: Write the pinning tests**

Append to `src/features/payroll/driver-pay-plan.test.ts` (imports `payPlanToFirestore` and `parseDriverPayPlan` if not already imported):

```ts
describe("stored plan schema", () => {
  it("writes the ladder under invalid_ladder, the key the deployed reader uses", () => {
    const stored = payPlanToFirestore(DEFAULT_DRIVER_PAY_PLAN);
    assert.deepEqual(stored.invalid_ladder, [7, 21, 120]);
    assert.equal(
      "invalid_days_ladder" in stored,
      false,
      "the functions reader never looks at invalid_days_ladder",
    );
  });

  it("writes the snake_case keys the reader reads", () => {
    const stored = payPlanToFirestore(DEFAULT_DRIVER_PAY_PLAN);
    assert.deepEqual(Object.keys(stored).sort(), [
      "bands",
      "base_kwd",
      "floor_kwd",
      "invalid_ladder",
      "low_base_kwd",
      "penalty_bike",
      "penalty_car",
      "threshold",
    ]);
  });

  it("still reads a plan stored under the legacy camelCase invalidLadder", () => {
    const { invalid_ladder: _dropped, ...rest } = payPlanToFirestore(DEFAULT_DRIVER_PAY_PLAN);
    const parsed = parseDriverPayPlan({ ...rest, invalidLadder: [13, 39, 220] });
    assert.deepEqual(parsed.invalidLadder, [13, 39, 220]);
  });

  it("ignores an unknown ladder key rather than half-reading it", () => {
    const { invalid_ladder: _dropped, ...rest } = payPlanToFirestore(DEFAULT_DRIVER_PAY_PLAN);
    const parsed = parseDriverPayPlan({ ...rest, invalid_days_ladder: [13, 39, 220] });
    assert.deepEqual(parsed.invalidLadder, DEFAULT_DRIVER_PAY_PLAN.invalidLadder);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npm run test:payroll`
Expected: PASS, including the four new cases. The last one is the important one: it documents that writing `invalid_days_ladder` is a **no-op**, not an override.

- [ ] **Step 4: Record the one real gap (do not fix it here)**

The deployed `driver-pay.ts:148` does not fall back to `invalidLadder`, while both TypeScript parsers do. A document that carries only the camelCase key is therefore read as the default 7 / 21 / 120 by the function and as the real ladder by admin. Nothing writes the camelCase key today — `payPlanToFirestore` emits `invalid_ladder` — so the editor path is safe.

Making the function tolerant is a **one-line change plus a Cloud Functions deploy**, which this plan may not do without approval. Leave it as a named follow-up in the handoff:

> `driver-pay.ts:148` — accept `invalidLadder` as well as `invalid_ladder`, then deploy `driverPayCalculator`/`driverGetPayCalculator` callables. Not done: needs approval.

- [ ] **Step 5: Commit**

```bash
git add src/features/payroll/driver-pay-plan.test.ts
git commit -m "Pin the stored driver pay plan schema"
```

---

### Task B1: The pay-plan page

**Files:**
- Create: `src/features/payroll/driver-pay-plan-page-shell.tsx`
- Create: `src/app/[locale]/(dashboard)/payroll/pay-plan/page.tsx`

**Interfaces:**
- Consumes: `PayPlanEditor({ canManage: boolean })` from `./pay-plan-editor`; `loadDriverPayPlan()` / `saveDriverPayPlan(locale, plan)` from `./pay-plan-actions` (already written, `payroll.view` to read, `payroll.manage` to write); `useAuth().can(slug)`.
- Produces: `DriverPayPlanPageShell()`.

- [ ] **Step 1: Write the shell**

`PayPlanEditor` renders no page header of its own (it imports neither `AppPage` nor `AppPageHeader`, and its copy keys `pages.payroll.payPlan.title` / `.hint` are already in both message files), so the shell owns the heading.

Create `src/features/payroll/driver-pay-plan-page-shell.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { AppPage, AppPageHeader } from "@/components/app";
import { useAuth } from "@/contexts/auth-context";
import { PayPlanEditor } from "./pay-plan-editor";

export function DriverPayPlanPageShell() {
  const t = useTranslations("pages.payroll.payPlan");
  const { can } = useAuth();

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("hint")} />
      <PayPlanEditor canManage={can("payroll.manage")} />
    </AppPage>
  );
}
```

- [ ] **Step 2: Write the route**

Create `src/app/[locale]/(dashboard)/payroll/pay-plan/page.tsx`:

```tsx
import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { DriverPayPlanPageShell } from "@/features/payroll/driver-pay-plan-page-shell";

export default async function PayPlanPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "payroll.view");

  return <DriverPayPlanPageShell />;
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success, and the route list includes `/[locale]/payroll/pay-plan`.

- [ ] **Step 4: Check the editor renders without writing anything**

Run: `npm run build`, then open `/{locale}/payroll/pay-plan` against the current environment and read the page only.

Expected: the editor renders the plan it read. With `app_settings/1.driver_pay_plan` unset it renders `DEFAULT_DRIVER_PAY_PLAN` (base 120, low base 90, threshold 300, floor 90, bands 301–400 @ 0.260 / 401–500 @ 0.350 / 501–600 @ 0.400 / 601+ @ 0.450, penalties bike −2 / car −3, ladder 7 / 21 / 120) — which is also the bug this task closes: MG-GO has been paying on numbers nobody could see.

**Do not press Save in this step.** Saving writes `app_settings/1`, and a payout setting is production data. Reading the page is fine; writing needs the approval in Step 6.

- [ ] **Step 5: Read the current stored value (read-only)**

In the Firestore console (`musallam-delivery-prod`), open `app_settings/1` and note whether `driver_pay_plan` exists.

Expected: it is **absent**, which is why the rider app has been calculating on defaults. Record what you see — the Step 6 comparison needs a "before".

- [ ] **Step 6: Save the plan — approval required, and check the keys**

This is a **production payout write**. It needs explicit approval naming `app_settings/1.driver_pay_plan` as the target, exactly like the compliance tier-3 step.

Once approved, press **Save** on the pay-plan page, then check the stored document against Task B0's contract:

```
driver_pay_plan: {
  base_kwd, low_base_kwd, threshold, floor_kwd,
  bands: [{ from, to, rate }],          // 601+ has to: null
  penalty_bike, penalty_car,
  invalid_ladder: [7, 21, 120]          // NOT invalid_days_ladder
}
updated_at, updated_by
```

Expected: a success toast, no `save_failed`, and a document whose keys match the list above. A `invalid_days_ladder` key here means the writer drifted from B0 and the deployed function will ignore the ladder — stop and fix the writer rather than the document.

- [ ] **Step 7: Commit**

```bash
git add src/features/payroll/driver-pay-plan-page-shell.tsx "src/app/[locale]/(dashboard)/payroll/pay-plan/page.tsx"
git commit -m "Mount the driver pay plan editor"
```

---

### Task B2: Link it from Payroll

**Files:**
- Modify: `src/features/payroll/payroll-page-shell.tsx:169-180` (the header actions), `src/lib/menu/menu-registry.ts` (hidden registry item)

- [ ] **Step 1: Add the header button**

`payroll-page-shell.tsx` is already a client component and already holds `canManage = can("payroll.manage")` at line 55. Inside the `actions` block's `<div className="flex flex-wrap gap-2">`, add as the first child:

```tsx
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => router.push("/payroll/pay-plan")}
            >
              <Calculator className="size-3.5" />
              {t("payPlan.title")}
            </Button>
```

The shell already imports `Button`; add `Calculator` to its `lucide-react` import and make sure `router` comes from `useRouter()` in `@/i18n/navigation` (the file already uses that router for navigation; reuse the existing binding or add `const router = useRouter();` next to the other hooks).

- [ ] **Step 2: Add the hidden registry item**

In `src/lib/menu/menu-registry.ts`, immediately after the `payroll` item (line ~550), add:

```ts
  {
    id: "pay-plan",
    defaultLabel: "Driver pay plan",
    defaultIcon: "Calculator",
    href: "/payroll/pay-plan",
    defaultGroup: "Operations",
    defaultOrder: 8.3,
    permission: "payroll.view",
    hidden: true,
  },
```

`hidden: true` keeps it out of the sidebar — the Payroll header button is the entry point — while still giving the route a registry entry. No `MENU_CACHE_VERSION` bump is needed for a hidden item.

- [ ] **Step 3: Verify the link and the guard**

Run: `npm run build`, then open `/{locale}/payroll`.

Expected: the header shows a "Driver pay plan" button; it opens the editor; signing in as a role with `payroll.view` but without `payroll.manage` shows the editor read-only (`readOnly` copy), and Save is absent or disabled.

- [ ] **Step 4: Commit**

```bash
git add src/features/payroll/payroll-page-shell.tsx src/lib/menu/menu-registry.ts
git commit -m "Link the pay plan editor from Payroll"
```

---

## Phase C — The rider Pay Calculator (rider repo, GATED)

**Do not start this phase without the owner's explicit approval.** The rider app is `c:\Users\Admin\Desktop\Vizsoft\MGgo-User\MG-GO` (branch `vk-firebase-dev`) — a separate repo and a separate Play release.

### Task C0: The gate

- [ ] **Step 1: Ask**

Ask the owner, in writing, whether the rider app may change for this. Phases A and B ship real value on their own (Operations can upload; MG-GO can see and edit its own pay plan). If the answer is no, stop and say so in the handoff — do **not** ship a half-wired calculator.

- [ ] **Step 2: Confirm the Play release path**

A new Play release needs `android/key.properties` and the keystore, neither of which is on this machine. Confirm the owner can produce them before starting; otherwise the work cannot reach riders.

---

### Task C1: Load the plan and the prefill

**Files:**
- Modify: `lib/features/earnings/earnings_service.dart`, `lib/features/earnings/earnings_providers.dart`

**Interfaces:**
- Consumes: `callRiderFunction(name, [data])` → `Future<Map<String, dynamic>>` (`lib/core/firebase/rider_backend.dart:50`); `PayCalculatorData.fromJson` from `./pay_plan.dart` (already written and correct).
- Produces: `EarningsService.loadPayCalculator(): Future<PayCalculatorData>`; `payCalculatorProvider: FutureProvider<PayCalculatorData>`.

- [ ] **Step 1: Add the service call**

In `lib/features/earnings/earnings_service.dart`, add `import 'pay_plan.dart';` (plus `import '../../core/firebase/rider_backend.dart';` if the file does not already reach `callRiderFunction`), then add next to `fetchPerformance()`:

```dart
  /// The rider's own plan plus this month's prefill. `driverGetPayCalculator`
  /// returns `{ plan, month }`; the plan falls back to the shipped default when
  /// the admin has never saved one, so this never throws on a fresh project.
  Future<PayCalculatorData> loadPayCalculator() async {
    final map = await callRiderFunction('driverGetPayCalculator');
    return PayCalculatorData.fromJson(map);
  }
```

- [ ] **Step 2: Add the provider**

In `lib/features/earnings/earnings_providers.dart`, add (and import `'pay_plan.dart'` if needed):

```dart
final payCalculatorProvider = FutureProvider<PayCalculatorData>((ref) async {
  return ref.watch(earningsServiceProvider).loadPayCalculator();
});
```

- [ ] **Step 3: Analyze**

Run: `flutter analyze lib`
Expected: `No issues found!`

- [ ] **Step 4: Commit**

```bash
git add lib/features/earnings/earnings_service.dart lib/features/earnings/earnings_providers.dart
git commit -m "Load the driver pay calculator data"
```

---

### Task C2: The screen

**Files:**
- Create: `lib/features/earnings/pay_calculator_screen.dart`
- Modify: `lib/l10n/app_en.arb`, `lib/l10n/app_ar.arb` (then `flutter gen-l10n`)

**Interfaces:**
- Consumes: `payCalculatorProvider` (Task C1); `computeDriverPay`, `defaultDriverPayPlan`, `DriverPayPlan`, `PayInput`, `PayVehicle`, `PayBreakdown` from `./pay_plan.dart`.
- Produces: `PayCalculatorScreen` with `static const routeName = 'pay_calculator';`.

- [ ] **Step 1: Write the stateful shell**

Create `lib/features/earnings/pay_calculator_screen.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../l10n/app_localizations.dart';
import 'earnings_providers.dart';
import 'pay_plan.dart';

class PayCalculatorScreen extends ConsumerStatefulWidget {
  const PayCalculatorScreen({super.key});

  static const routeName = 'pay_calculator';

  @override
  ConsumerState<PayCalculatorScreen> createState() => _PayCalculatorScreenState();
}

class _PayCalculatorScreenState extends ConsumerState<PayCalculatorScreen> {
  int _orders = 0;
  int _rejected = 0;
  int _cancelled = 0;
  int _invalidDays = 0;
  PayVehicle _vehicle = PayVehicle.bike;
  bool _prefilled = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final async = ref.watch(payCalculatorProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.payCalculatorTitle)),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => _Body(
          plan: defaultDriverPayPlan,
          orders: _orders,
          vehicle: _vehicle,
          rejected: _rejected,
          cancelled: _cancelled,
          invalidDays: _invalidDays,
          onOrders: (v) => setState(() => _orders = v),
          onRejected: (v) => setState(() => _rejected = v),
          onCancelled: (v) => setState(() => _cancelled = v),
          onInvalidDays: (v) => setState(() => _invalidDays = v),
          onVehicle: (v) => setState(() => _vehicle = v),
          stale: true,
        ),
        data: (data) {
          // Prefill once, from what the callable returned. Later edits belong to
          // the rider, so a rebuild must not stamp over them.
          if (!_prefilled) {
            _prefilled = true;
            _orders = data.prefill.orders;
            _rejected = data.prefill.rejected;
            _cancelled = data.prefill.cancelled;
            _invalidDays = data.prefill.invalidDays;
            _vehicle = data.prefill.vehicle;
          }
          return _Body(
            plan: data.plan,
            orders: _orders,
            vehicle: _vehicle,
            rejected: _rejected,
            cancelled: _cancelled,
            invalidDays: _invalidDays,
            onOrders: (v) => setState(() => _orders = v),
            onRejected: (v) => setState(() => _rejected = v),
            onCancelled: (v) => setState(() => _cancelled = v),
            onInvalidDays: (v) => setState(() => _invalidDays = v),
            onVehicle: (v) => setState(() => _vehicle = v),
            stale: false,
          );
        },
      ),
    );
  }
}
```

Open `lib/features/earnings/pay_plan.dart:323-400` first and use its real member names for `PayPlanPrefill` and `PayVehicle` (`PayVehicle.parse` is at line 14; the prefill class starts at line 323). If a member is named differently, rename it **here**, never in `pay_plan.dart`.

- [ ] **Step 2: Write the body — inputs, live output, tier table**

Append to the same file:

```dart
class _Body extends StatelessWidget {
  const _Body({
    required this.plan,
    required this.orders,
    required this.vehicle,
    required this.rejected,
    required this.cancelled,
    required this.invalidDays,
    required this.onOrders,
    required this.onRejected,
    required this.onCancelled,
    required this.onInvalidDays,
    required this.onVehicle,
    required this.stale,
  });

  final DriverPayPlan plan;
  final int orders;
  final PayVehicle vehicle;
  final int rejected;
  final int cancelled;
  final int invalidDays;
  final ValueChanged<int> onOrders;
  final ValueChanged<int> onRejected;
  final ValueChanged<int> onCancelled;
  final ValueChanged<int> onInvalidDays;
  final ValueChanged<PayVehicle> onVehicle;
  final bool stale;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final breakdown = computeDriverPay(
      plan,
      PayInput(
        orders: orders,
        vehicle: vehicle,
        rejected: rejected,
        cancelled: cancelled,
        invalidDays: invalidDays,
      ),
    );

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (stale)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              l10n.payCalculatorOffline,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        SegmentedButton<PayVehicle>(
          segments: [
            ButtonSegment(value: PayVehicle.bike, label: Text(l10n.payVehicleBike)),
            ButtonSegment(value: PayVehicle.car, label: Text(l10n.payVehicleCar)),
          ],
          selected: {vehicle},
          onSelectionChanged: (s) => onVehicle(s.first),
        ),
        const SizedBox(height: 12),
        _NumberField(label: l10n.payFieldOrders, value: orders, onChanged: onOrders),
        _NumberField(label: l10n.payFieldRejected, value: rejected, onChanged: onRejected),
        _NumberField(
          label: l10n.payFieldCancelled,
          value: cancelled,
          onChanged: onCancelled,
        ),
        _NumberField(
          label: l10n.payFieldInvalidDays,
          value: invalidDays,
          onChanged: onInvalidDays,
        ),
        const SizedBox(height: 16),
        _MoneyRow(label: l10n.payBase, value: breakdown.base),
        ...breakdown.bands.map(
          (line) => _MoneyRow(
            label: l10n.payBandLine(line.from, line.to),
            value: line.amount,
          ),
        ),
        _MoneyRow(label: l10n.payPenalty, value: breakdown.penalty),
        _MoneyRow(label: l10n.payInvalidDaysLine, value: breakdown.invalidDaysAmount),
        const Divider(),
        _MoneyRow(label: l10n.payNet, value: breakdown.net, emphasis: true),
        const SizedBox(height: 24),
        Text(l10n.payTierTitle, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ...plan.bands.map(
          (band) => _MoneyRow(
            label: l10n.payBandLine(band.from, band.to),
            value: band.rate,
          ),
        ),
      ],
    );
  }
}

/// A stepper over a non-negative count: the calculator's inputs are whole
/// numbers, and a keyboard-only field on a phone invites a fat-fingered total.
class _NumberField extends StatelessWidget {
  const _NumberField({
    required this.label,
    required this.value,
    required this.onChanged,
  });

  final String label;
  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(child: Text(label)),
          IconButton(
            onPressed: value > 0 ? () => onChanged(value - 1) : null,
            icon: const Icon(Icons.remove_circle_outline),
          ),
          SizedBox(
            width: 48,
            child: Text('$value', textAlign: TextAlign.center),
          ),
          IconButton(
            onPressed: () => onChanged(value + 1),
            icon: const Icon(Icons.add_circle_outline),
          ),
        ],
      ),
    );
  }
}

class _MoneyRow extends StatelessWidget {
  const _MoneyRow({required this.label, required this.value, this.emphasis = false});

  final String label;
  final double value;
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final style = emphasis
        ? Theme.of(context).textTheme.titleMedium
        : Theme.of(context).textTheme.bodyMedium;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text('${money3(value).toStringAsFixed(3)} KWD', style: style),
        ],
      ),
    );
  }
}
```

Use the field names `PayBreakdown` actually declares (`lib/features/earnings/pay_plan.dart:102-133`) and the tile styling its siblings use (`_LineItem`, `earnings_day_detail_screen.dart:187`). The tier table is the last block: `plan.bands.map(...)` with `payBandLine(from, to)` and the rate, which is the client's "Under 300 / 301–400 / 401–500 / 501–600 / Above 600" reference.

- [ ] **Step 3: Handle the open-ended top band**

`PayBand.to` is nullable, and an ARB message cannot take a null placeholder. Add this helper below `_MoneyRow`, then replace both inline `l10n.payBandLine(...)` calls in `_Body` with `_bandLabel(l10n, ...)`:

```dart
String _bandLabel(AppLocalizations l10n, int from, int? to) =>
    to == null ? l10n.payBandOpen(from) : l10n.payBandLine(from, to);
```

So `_MoneyRow(label: l10n.payBandLine(line.from, line.to), ...)` becomes `_MoneyRow(label: _bandLabel(l10n, line.from, line.to), ...)` in both places — the breakdown lines and the tier table.

- [ ] **Step 4: Route it**

In `lib/core/router/app_router.dart`, add next to the `earnings_day` route (line ~279, after the `EarningsDayDetailScreen` `GoRoute` closes):

```dart
      GoRoute(
        path: '/earnings/pay-calculator',
        name: PayCalculatorScreen.routeName,
        parentNavigatorKey: rootNavigatorKey,
        builder: (context, state) => const PayCalculatorScreen(),
      ),
```

Add `import '../../features/earnings/pay_calculator_screen.dart';` beside the other earnings imports (lines 23-24).

- [ ] **Step 5: Reach it from the Earnings screen**

In `lib/features/earnings/earnings_screen.dart`, add an entry row next to the existing day/progress rows, mirroring whatever tile pattern the file already uses for a pushed screen:

```dart
        ListTile(
          leading: const Icon(Icons.calculate_outlined),
          title: Text(l10n.payCalculatorTitle),
          subtitle: Text(l10n.payCalculatorHint),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.pushNamed(PayCalculatorScreen.routeName),
        ),
```

Add the import and, if `earnings_screen.dart` is a `ConsumerWidget`/`ConsumerStatefulWidget`, use the same `context` already used for navigation in that file (`go_router`'s `context.pushNamed` is what the other rows use — copy that call, do not invent a `Navigator.push`).

- [ ] **Step 6: Add the strings**

In `lib/l10n/app_en.arb`:

```json
  "payCalculatorTitle": "Pay calculator",
  "payCalculatorHint": "Estimate this month's pay from your own numbers",
  "payCalculatorOffline": "Showing the standard plan — this month's numbers could not be loaded.",
  "payVehicleBike": "Bike",
  "payVehicleCar": "Car",
  "payFieldOrders": "Valid completed orders",
  "payFieldRejected": "Rejected orders",
  "payFieldCancelled": "Cancelled orders",
  "payFieldInvalidDays": "Invalid days",
  "payBase": "Base pay",
  "payBandLine": "Orders {from}–{to}",
  "payBandOpen": "Orders {from} and above",
  "payPenalty": "Order penalties",
  "payInvalidDaysLine": "Invalid-day deduction",
  "payNet": "Net monthly pay",
  "payTierTitle": "Per-order rates",
```

In `lib/l10n/app_ar.arb`, the same keys:

```json
  "payCalculatorTitle": "حاسبة الراتب",
  "payCalculatorHint": "احسب راتب هذا الشهر من أرقامك",
  "payCalculatorOffline": "يتم عرض الخطة الأساسية — تعذّر تحميل أرقام هذا الشهر.",
  "payVehicleBike": "دراجة",
  "payVehicleCar": "سيارة",
  "payFieldOrders": "الطلبات المكتملة الصالحة",
  "payFieldRejected": "الطلبات المرفوضة",
  "payFieldCancelled": "الطلبات الملغاة",
  "payFieldInvalidDays": "الأيام غير الصالحة",
  "payBase": "الراتب الأساسي",
  "payBandLine": "الطلبات {from}–{to}",
  "payBandOpen": "الطلبات {from} وأكثر",
  "payPenalty": "خصم الطلبات",
  "payInvalidDaysLine": "خصم الأيام غير الصالحة",
  "payNet": "صافي الراتب الشهري",
  "payTierTitle": "سعر الطلب لكل شريحة",
```

Then run `flutter gen-l10n` and confirm the generated `lib/l10n/app_localizations*.dart` files are updated (they are tracked).

- [ ] **Step 7: Verify**

Run: `flutter analyze lib` and `flutter test`
Expected: `No issues found!` and all tests pass. `pay_plan.dart`'s own tests must stay green — the engine is not being changed.

Then run the app against production (`flutter run --dart-define-from-file=env/prod.json`) as a rider who has compliance rows this month:
1. The four fields prefill from `driverGetPayCalculator` (orders, rejected, cancelled, invalid days) and the vehicle matches the rider's assigned vehicle.
2. Changing orders updates base, the band lines and the net immediately.
3. Switching Bike ↔ Car changes the penalty by 1 KD.
4. The tier table lists the bands from `app_settings/1.driver_pay_plan` — change a rate in Admin → Payroll → Driver pay plan, reopen the calculator, and the new rate appears.
5. Airplane mode: the screen still renders with `defaultDriverPayPlan` and shows the offline line.

- [ ] **Step 8: Commit**

```bash
git add lib/features/earnings lib/core/router/app_router.dart lib/l10n
git commit -m "Add the rider pay calculator screen"
```

**Release note:** this is a Play release. Build with the keystore from `android/key.properties` (missing on this machine), bump `version:` in `pubspec.yaml`, and follow the existing signing pipeline. Do not ship an APK build as a release.

---

## Before claiming done

**Tier 1 — run all of it, paste the output into the handoff:**

```bash
npm run test:compliance                              # 16 tests
npm run test:payroll                                 # includes the 4 schema cases from Task B0
node --import tsx --test src/lib/auth/mutation-auth-coverage.test.ts
npx tsc --noEmit -p tsconfig.json                    # no errors
npm run lint                                         # no errors
node scripts/check-messages.mjs                      # messages OK
npm run build                                        # /[locale]/compliance and /[locale]/payroll/pay-plan
npx firebase emulators:exec --only firestore --project demo-compliance "node --import tsx scripts/compliance-emulator-check.mjs"
```

Every one of those is green before any live step is attempted. If any fails, fix it or report it as a blocker — do not proceed to a live step and do not mark a task complete on top of a red suite.

**Tier 2 — the live proofs, each of which needs approval:**

1. **A rider's week card moves after an upload.** Task A6 Step 6.
2. **`driverGetPayCalculator` returns the band you just edited**, against the saved plan. Task B1 Step 6 + Task C2 Step 7.4 (Phase C is itself gated).

**Deploys: none, unless approved.** No Cloud Function deploy is required by Phases A and B: the only function involved, `adminNotifyComplianceRefresh`, is live on `me-central1`, and the writer is a server action on the Admin SDK. If a deploy is proposed mid-implementation, the design has drifted — stop and re-read Task A2. Admin prod deploy, Cloud Functions deploy, rider-app release and any production data write are all separate approvals.

**Report blockers before marking anything complete.** A short block, in the handoff, for each of:

- Which steps were **not** run because approval was not given, named individually (e.g. "A6 Step 6 not run: no approval for a production write").
- Anything that failed and was worked around, with the workaround spelled out.
- The ladder follow-up from Task B0 Step 4 (`driver-pay.ts:148` camelCase tolerance + deploy), which is deliberately **not** done.
- Whether the client's six open questions below are still open.

**Deliberately out of scope**, to be said out loud in the handoff:
- No CSV export of stored compliance rows (Operations asked to upload, not to download).
- No approval workflow on an upload: `compliance.manage` is the whole gate, and the audit log records every batch id with its written/planned row counts.
- No per-upload undo. A corrected file re-uploaded for the same rider-day is the undo.
- Node.js 20 → 22 (deadline 2026-10-30) and the Play release are separate work, not tasks here.

---

## Open questions for the client

These are unanswered and each one can change the code. Ask before the affected task is declared finished; Task A6 carries a checkpoint for the first.

1. **Can Operations produce one row per rider-day, or only monthly totals?** The upload is built daily (`{driverId}_{day}`), because the rider's Home card is a *week* card and the calculator is *monthly*. A single monthly figure cannot be spread across days. If only monthly totals exist, the storage shape and both readers change.
2. **Is a "rejected order" penalty per order or per month?** `computeDriverPay` multiplies `rejected + cancelled` by `penalty_bike` / `penalty_car`, i.e. per order. The example damage the client quoted (−2 KD / −3 KD) reads like a per-order rate, but confirm.
3. **What does "Under 300" in the tier table mean?** There is no band below 301 in the plan beyond `base_kwd`; the table's first row is therefore informational. If under-threshold orders are meant to earn a per-order rate, that is a new band.
4. **Confirm the ladder numbers.** The engine reads `invalid_ladder` (Task B0 settled the key name) as **1 day → 7 KD, 2 days → 21 KD, 3+ days → 120 KD** (13/39/220 in the second file the client sent). Admin copy was corrected to match the engine; the client must confirm the engine is right, not the copy.
5. **KeeTa or MG-GO branding on the rider screens?** The Home compliance card and the calculator live in the same app that currently signs in with "Delivery Partner" / "MGHub". Adding "KeeTa" to one screen and not the others will read as a bug to a rider.
6. **What does "real-time" require?** The upload already pushes a silent data-only FCM refresh, so an app in the foreground updates within seconds and a cold start always shows truth. If the client expects an open card to repaint with no push handling on the client, that is a rider-app change (Phase C territory).

---

## Self-review: does every requirement have a task?

| Requirement | Where it is satisfied |
|---|---|
| F1 · home screen shows Invalid Days / Rejections / Cancellations | Already shipped; proven by Task A0 |
| F1 · admin portal bulk uploads CSV/Excel of rider IDs → metrics | Tasks A1-A6 (parser, actions, page, permission, route) |
| F1 · uploaded data syncs immediately to the rider app | Task A2 Step 3 (chunked `adminNotifyComplianceRefresh`, run even on a partial write), proven in Task A6 Step 6 |
| F2 · inputs: orders, vehicle, rejected/cancelled, invalid days | Task C2 Steps 1-2 |
| F2 · live output: base, bands, penalties, net | Task C2 Step 2 (`computeDriverPay` is already the engine) |
| F2 · tier reference display (Under 300 … Above 600) | Task C2 Step 2's closing tier table; open question 3 for "Under 300" |
| (enabling) · MG-GO can see and change the plan the rider is paid on | Tasks B0-B2 |
| Review 1 · `employee_id` OR `driver_code`, optional metrics, required columns block | Upload contract; A1 Steps 3-4; A2 Step 3; A3 Step 2 |
| Review 2 · server revalidates and normalises every row | A2 Steps 2-3 (raw sheet in, re-parsed), A1 Step 4 (`normalizeCell`) |
| Review 3 · duplicates across both id columns | A1 Step 4 (`dedupeResolvedRows`), called in A2 Step 2 |
| Review 4 · partial writes reported honestly | A1 `commitComplianceWrites` + 3 tests, used in A2 Step 3, surfaced in A3/A5 copy |
| Review 5 · `invalid_ladder` vs `invalid_days_ladder` | Task B0 (audit + 4 pinning tests) and the finding at the top |
| Review 6 · emulator/staging, no unapproved prod writes | Task A6 Steps 3-6; Task B1 Steps 4-6; "Before claiming done" |
| Review 7 · rider-app gate preserved | Task C0, unchanged |
| Review 8 · tests, typecheck, lint, build, blockers | "Before claiming done" |

**Verified facts this plan depends on** (each was checked in the repo, not assumed):

- `.firebaserc` names only `musallam-delivery-prod`, and `firebase.json` has **no** `emulators` block. There is no staging project today, which is why Task A6 Step 6 makes the live run an explicit approval rather than a default step.
- `src/lib/auth/mutation-auth-coverage.test.ts` exists but is in **no** `package.json` script; it has to be named to run (Task A2 Step 4).
- `src/features/payroll/driver-pay-plan.test.ts` already exists and is wired into `test:payroll`; Task B0 extends it rather than adding a suite nobody runs.
- `payPlanToFirestore` writes eight keys, listed in Task B0 Step 2 — the ladder under `invalid_ladder`.

**Placeholder scan.** No step says "add validation" or "handle edge cases" without the code. Two steps defer a *name* to the source and say why: Task C2 uses the member names actually declared in `pay_plan.dart` (`PayPlanPrefill`, `PayBreakdown`) rather than inventing fields, and Task A4 checks whether `ClipboardCheck` is in the registry's icon map before using it. Everything else is literal code.

**Type consistency.** Crossing names are used identically throughout: `ComplianceSheet`, `ComplianceSheetIssues`, `ComplianceUploadRow`, `CompliancePreviewRow`, `ComplianceRowStatus`, `CompliancePreview`, `CompliancePreviewResult`, `ComplianceApplyResult`, `ComplianceWrite`, `parseComplianceSheet`, `normalizeCell`, `dedupeResolvedRows`, `buildComplianceWrites`, `commitComplianceWrites`, `resolveComplianceSheet`, `previewRiderComplianceUpload`, `applyRiderComplianceUpload`, `RiderComplianceUploadShell`, `DriverPayPlanPageShell`, `loadPayCalculator`, `payCalculatorProvider`, `PayCalculatorScreen`. `ComplianceDriverFacts` was dropped in review because Task A2 resolves riders through the existing `resolveDriversByLookupIds` / `decideImportRowMatch`, so a third shape would have been dead code.

**One thing this plan does not do.** It does not touch `functions/` or `firestore.rules`. If an implementer finds themselves editing a Cloud Function to make the upload work, the design has drifted: the writer is a server action on the Admin SDK, exactly like every other staff write in this repo. The single function change that *would* improve things — camelCase tolerance in `driver-pay.ts:148` — is recorded as an approval-gated follow-up in Task B0 Step 4 and is not part of any task here.

