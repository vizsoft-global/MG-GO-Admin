import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { COLLECTIONS } from "../core/collections";
import {
  driverGetDefaultVisitBranch,
  driverListComplaintCategories,
  driverListEarningsDaily,
  driverListMyDeliveries,
  driverListMyVisits,
  driverListPayouts,
  driverListRequestFields,
  driverListRequestTypes,
  driverListTenureOptions,
  driverListVisitDepartments,
  driverListsDeps,
} from "./driver-lists";

const UID = "rider-1";
const OTHER = "rider-2";

type Doc = { id: string; data: Record<string, unknown> };
type Filter = { field: string; op: string; value: unknown };
type Order = { field: string; dir: string };

const original = {
  requireRider: driverListsDeps.requireRider,
  getFirestore: driverListsDeps.getFirestore,
};

function req(data: Record<string, unknown> = {}): CallableRequest<unknown> {
  return { data, auth: { uid: UID } } as CallableRequest<unknown>;
}

function rider(uid = UID) {
  return { uid, driver: { id: uid }, profile: { role: "rider" } };
}

function matches(data: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const actual = data[filter.field] ?? null;
    if (filter.op === "==") return actual === filter.value;
    if (filter.op === "in") {
      return Array.isArray(filter.value) && filter.value.includes(actual);
    }
    if (filter.op === ">=") return String(actual) >= String(filter.value);
    if (filter.op === "<=") return String(actual) <= String(filter.value);
    return false;
  });
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "boolean" || typeof b === "boolean") {
    return Number(Boolean(a)) - Number(Boolean(b));
  }
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function mockDb(store: Record<string, Doc[]>) {
  function query(name: string, filters: Filter[], orders: Order[], cap: number | null) {
    return {
      where(field: string, op: string, value: unknown) {
        return query(name, [...filters, { field, op, value }], orders, cap);
      },
      orderBy(field: string, dir = "asc") {
        return query(name, filters, [...orders, { field, dir }], cap);
      },
      limit(n: number) {
        return query(name, filters, orders, n);
      },
      async get() {
        let rows = (store[name] ?? []).filter((doc) => matches(doc.data, filters));
        for (const order of [...orders].reverse()) {
          rows = [...rows].sort((a, b) => {
            const delta = compare(a.data[order.field], b.data[order.field]);
            return order.dir === "desc" ? -delta : delta;
          });
        }
        if (cap !== null) rows = rows.slice(0, cap);
        return {
          docs: rows.map((doc) => ({
            id: doc.id,
            data: () => doc.data,
          })),
        };
      },
    };
  }
  return {
    collection(name: string) {
      return query(name, [], [], null);
    },
  };
}

afterEach(() => {
  driverListsDeps.requireRider = original.requireRider;
  driverListsDeps.getFirestore = original.getFirestore;
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe("driver-lists auth", () => {
  it("refuses a caller that requireRider rejects", async () => {
    driverListsDeps.requireRider = async () => {
      throw new HttpsError("unauthenticated", "not_authenticated");
    };
    driverListsDeps.getFirestore = () => mockDb({}) as never;
    await assert.rejects(() => driverListMyDeliveries.run(req()), (error: unknown) => {
      assert.equal(messageOf(error), "not_authenticated");
      return true;
    });
  });
});

describe("driverListMyDeliveries", () => {
  it("scopes to driver_id and keeps in_transit plus cancelled", async () => {
    driverListsDeps.requireRider = async () => rider();
    driverListsDeps.getFirestore = () =>
      mockDb({
        [COLLECTIONS.deliveries]: [
          { id: "own-transit", data: { driver_id: UID, status: "in_transit", created_at: "2" } },
          { id: "own-cancel", data: { driver_id: UID, status: "cancelled", created_at: "1" } },
          { id: "other", data: { driver_id: OTHER, status: "verified", created_at: "3" } },
        ],
      }) as never;

    const result = await driverListMyDeliveries.run(req({ limit: 50 }));
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.rows.map((row: { id: string; status: string }) => [row.id, row.status]),
      [
        ["own-transit", "in_transit"],
        ["own-cancel", "cancelled"],
      ],
    );
  });
});

describe("driverListEarningsDaily", () => {
  it("keeps only the earn_date window for this rider", async () => {
    driverListsDeps.requireRider = async () => rider();
    driverListsDeps.getFirestore = () =>
      mockDb({
        [COLLECTIONS.driverEarningsDaily]: [
          { id: "sep", data: { driver_id: UID, earn_date: "2026-09-30", net_kwd: 1 } },
          { id: "oct", data: { driver_id: UID, earn_date: "2026-10-09", net_kwd: 2 } },
          { id: "nov", data: { driver_id: UID, earn_date: "2026-11-01", net_kwd: 3 } },
          { id: "other-oct", data: { driver_id: OTHER, earn_date: "2026-10-09", net_kwd: 9 } },
        ],
      }) as never;

    const result = await driverListEarningsDaily.run(
      req({ p_from: "2026-10-01", p_to: "2026-10-31" }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.rows.map((row: { id: string }) => row.id),
      ["oct"],
    );
  });

  it("rejects a missing date window with the old RPC string", async () => {
    driverListsDeps.requireRider = async () => rider();
    driverListsDeps.getFirestore = () => mockDb({}) as never;
    await assert.rejects(() => driverListEarningsDaily.run(req({})), (error: unknown) => {
      assert.equal(messageOf(error), "invalid_date");
      return true;
    });
  });
});

describe("driverListPayouts", () => {
  it("returns only approved and paid rows", async () => {
    driverListsDeps.requireRider = async () => rider();
    driverListsDeps.getFirestore = () =>
      mockDb({
        [COLLECTIONS.driverPayouts]: [
          { id: "paid", data: { driver_id: UID, status: "paid", period_end: "2026-09-30" } },
          { id: "approved", data: { driver_id: UID, status: "approved", period_end: "2026-08-31" } },
          { id: "draft", data: { driver_id: UID, status: "draft", period_end: "2026-10-31" } },
          { id: "other", data: { driver_id: OTHER, status: "paid", period_end: "2026-10-31" } },
        ],
      }) as never;

    const result = await driverListPayouts.run(req());
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.rows.map((row: { id: string }) => row.id),
      ["paid", "approved"],
    );
  });
});

describe("catalog lists", () => {
  it("lists active request types, fields, tenure and complaint rows", async () => {
    driverListsDeps.requireRider = async () => rider();
    driverListsDeps.getFirestore = () =>
      mockDb({
        [COLLECTIONS.requestTypeDefinitions]: [
          {
            id: "loan",
            data: {
              key: "loan",
              label_en: "Loan",
              label_ar: "قرض",
              icon_key: "cash",
              is_system: true,
              is_active: true,
              sort_order: 1,
              date_range_required: false,
              min_attachments: 0,
              attachments_error_code: null,
            },
          },
          { id: "dead", data: { key: "old", is_active: false, sort_order: 0 } },
        ],
        [COLLECTIONS.requestFieldDefinitions]: [
          {
            id: "tenure",
            data: {
              type_key: "loan",
              field_key: "tenure_months",
              label_en: "Tenure",
              label_ar: null,
              kind: "select",
              target: "payload",
              is_required: true,
              sort_order: 1,
              options_source: "loan_tenure_options",
              options: [],
              min_value: 3,
              max_value: 24,
              help_en: "Months",
              help_ar: null,
            },
          },
          { id: "other", data: { type_key: "leave", field_key: "x", sort_order: 1 } },
        ],
        [COLLECTIONS.loanTenureOptions]: [
          { id: "m3", data: { months: 3, label: "3 months", is_active: true, sort_order: 1 } },
          { id: "off", data: { months: 99, label: "off", is_active: false, sort_order: 2 } },
        ],
        [COLLECTIONS.complaintCategories]: [
          {
            id: "pay",
            data: { key: "payments", label_en: "Payments", label_ar: "المدفوعات", is_active: true, sort_order: 1 },
          },
        ],
      }) as never;

    const types = await driverListRequestTypes.run(req());
    assert.equal(types.rows.length, 1);
    assert.equal(types.rows[0].key, "loan");

    const fields = await driverListRequestFields.run(req({ p_type_key: "loan" }));
    assert.equal(fields.rows.length, 1);
    assert.equal(fields.rows[0].field_key, "tenure_months");

    const tenure = await driverListTenureOptions.run(req());
    assert.deepEqual(tenure.rows, [{ months: 3, label: "3 months" }]);

    const cats = await driverListComplaintCategories.run(req());
    assert.equal(cats.rows[0].key, "payments");
  });
});

describe("visit lists", () => {
  it("returns the default active branch or null", async () => {
    driverListsDeps.requireRider = async () => rider();
    driverListsDeps.getFirestore = () =>
      mockDb({
        [COLLECTIONS.visitBranches]: [
          { id: "b2", data: { is_active: true, is_default: false, sort_order: 1, name: "Other" } },
          { id: "b1", data: { is_active: true, is_default: true, sort_order: 2, name: "Tower" } },
        ],
      }) as never;
    const result = await driverGetDefaultVisitBranch.run(req());
    assert.equal(result.branch?.id, "b1");
  });

  it("merges unscoped and branch-scoped departments", async () => {
    driverListsDeps.requireRider = async () => rider();
    driverListsDeps.getFirestore = () =>
      mockDb({
        [COLLECTIONS.visitDepartments]: [
          { id: "all", data: { key: "hr", label_en: "HR", label_ar: "HR", branch_id: null, is_active: true, sort_order: 1 } },
          { id: "here", data: { key: "fleet", label_en: "Fleet", label_ar: null, branch_id: "b1", is_active: true, sort_order: 2 } },
          { id: "there", data: { key: "acc", label_en: "Acc", label_ar: null, branch_id: "b2", is_active: true, sort_order: 3 } },
        ],
      }) as never;
    const result = await driverListVisitDepartments.run(req({ p_branch_id: "b1" }));
    assert.deepEqual(
      result.rows.map((row: { key: string }) => row.key),
      ["hr", "fleet"],
    );
  });

  it("lists this rider's visits newest scheduled_date first", async () => {
    driverListsDeps.requireRider = async () => rider();
    driverListsDeps.getFirestore = () =>
      mockDb({
        [COLLECTIONS.visitBookings]: [
          {
            id: "v1",
            data: {
              driver_id: UID,
              booking_code: "VIS-1",
              department_key: "hr",
              scheduled_date: "2026-10-01",
              status: "confirmed",
              note: "n",
              note_to_rider: "r",
            },
          },
          {
            id: "v2",
            data: {
              driver_id: UID,
              booking_code: "VIS-2",
              department_key: "hr",
              scheduled_date: "2026-10-09",
              status: "cancelled",
              note: null,
              note_to_rider: null,
            },
          },
          { id: "other", data: { driver_id: OTHER, scheduled_date: "2026-10-10", booking_code: "VIS-X" } },
        ],
      }) as never;
    const result = await driverListMyVisits.run(req());
    assert.deepEqual(
      result.rows.map((row: { id: string }) => row.id),
      ["v2", "v1"],
    );
  });
});
