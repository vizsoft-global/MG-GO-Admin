import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { COLLECTIONS } from "../core/collections";
import {
  SIGNED_URL_EXPIRES_IN,
  driverGetDownloadUrl,
  driverGetUploadUrl,
  driverStorageDeps,
  objectKeyOwnedByRider,
} from "./driver-storage";

const UID = "rider-1";
const OTHER = "rider-2";

type Doc = { id: string; data: Record<string, unknown> };
type Filter = { field: string; op: string; value: unknown };

const original = {
  requireRider: driverStorageDeps.requireRider,
  getFirestore: driverStorageDeps.getFirestore,
  getStorage: driverStorageDeps.getStorage,
};

function req(data: Record<string, unknown> = {}): CallableRequest<unknown> {
  return { data, auth: { uid: UID } } as CallableRequest<unknown>;
}

function rider(uid = UID) {
  return { uid, driver: { id: uid }, profile: { role: "rider" } };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function matches(data: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const actual = data[filter.field] ?? null;
    if (filter.op === "==") return actual === filter.value;
    if (filter.op === "in") {
      return Array.isArray(filter.value) && filter.value.includes(actual);
    }
    return false;
  });
}

function mockDb(store: Record<string, Doc[]>) {
  function query(name: string, filters: Filter[], cap: number | null) {
    return {
      where(field: string, op: string, value: unknown) {
        return query(name, [...filters, { field, op, value }], cap);
      },
      orderBy() {
        return query(name, filters, cap);
      },
      limit(n: number) {
        return query(name, filters, n);
      },
      doc(id: string) {
        return {
          async get() {
            const found = (store[name] ?? []).find((doc) => doc.id === id);
            return {
              id,
              exists: Boolean(found),
              data: () => found?.data ?? {},
            };
          },
        };
      },
      async get() {
        let rows = (store[name] ?? []).filter((doc) => matches(doc.data, filters));
        if (cap !== null) rows = rows.slice(0, cap);
        return {
          empty: rows.length === 0,
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
      return query(name, [], null);
    },
  };
}

function mockStorage(paths: string[] = []) {
  return () => ({
    bucket() {
      return {
        file(path: string) {
          return {
            async getSignedUrl(opts: { action: string }) {
              paths.push(`${opts.action}:${path}`);
              return [`https://signed.example/${path}?a=${opts.action}`];
            },
          };
        },
      };
    },
  });
}

afterEach(() => {
  driverStorageDeps.requireRider = original.requireRider;
  driverStorageDeps.getFirestore = original.getFirestore;
  driverStorageDeps.getStorage = original.getStorage;
});

describe("objectKeyOwnedByRider", () => {
  it("is the uid/ prefix rule", () => {
    assert.equal(objectKeyOwnedByRider(UID, `${UID}/sig.png`), true);
    assert.equal(objectKeyOwnedByRider(UID, `${OTHER}/sig.png`), false);
  });
});

describe("driverGetUploadUrl", () => {
  it("refuses when requireRider refuses", async () => {
    driverStorageDeps.requireRider = async () => {
      throw new HttpsError("unauthenticated", "not_authenticated");
    };
    await assert.rejects(
      () =>
        driverGetUploadUrl.run(
          req({ bucket: "esign-documents", object_key: `${UID}/a.png`, content_type: "image/png" }),
        ),
      (error: unknown) => {
        assert.equal(messageOf(error), "not_authenticated");
        return true;
      },
    );
  });

  it("refuses an object_key that is not under the rider prefix", async () => {
    driverStorageDeps.requireRider = async () => rider();
    driverStorageDeps.getStorage = mockStorage() as never;
    await assert.rejects(
      () =>
        driverGetUploadUrl.run(
          req({
            bucket: "request-attachments",
            object_key: `${OTHER}/file.jpg`,
            content_type: "image/jpeg",
          }),
        ),
      (error: unknown) => {
        assert.equal(messageOf(error), "invalid_object_key");
        return true;
      },
    );
  });

  it("returns storage_unavailable when Admin storage is missing", async () => {
    driverStorageDeps.requireRider = async () => rider();
    driverStorageDeps.getStorage = () => {
      throw new Error("no default bucket");
    };
    await assert.rejects(
      () =>
        driverGetUploadUrl.run(
          req({
            bucket: "fuel-fills",
            object_key: `${UID}/fill.jpg`,
            content_type: "image/jpeg",
          }),
        ),
      (error: unknown) => {
        assert.equal(messageOf(error), "storage_unavailable");
        return true;
      },
    );
  });

  it("signs a write URL on the default-bucket path", async () => {
    const paths: string[] = [];
    driverStorageDeps.requireRider = async () => rider();
    driverStorageDeps.getStorage = mockStorage(paths) as never;
    const result = await driverGetUploadUrl.run(
      req({
        bucket: "fuel-fills",
        object_key: `${UID}/fill.jpg`,
        content_type: "image/jpeg",
      }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.object_key, `${UID}/fill.jpg`);
    assert.equal(result.expires_in, SIGNED_URL_EXPIRES_IN);
    assert.equal(result.url, "https://signed.example/fuel-fills/rider-1/fill.jpg?a=write");
    assert.deepEqual(paths, ["write:fuel-fills/rider-1/fill.jpg"]);
  });
});

describe("driverGetDownloadUrl", () => {
  it("allows the rider prefix and refuses a foreign key with no ledger row", async () => {
    driverStorageDeps.requireRider = async () => rider();
    driverStorageDeps.getFirestore = () => mockDb({}) as never;
    driverStorageDeps.getStorage = mockStorage() as never;

    const own = await driverGetDownloadUrl.run(
      req({ bucket: "esign-documents", object_key: `${UID}/sig.png` }),
    );
    assert.equal(own.ok, true);
    assert.equal(own.expires_in, SIGNED_URL_EXPIRES_IN);

    await assert.rejects(
      () =>
        driverGetDownloadUrl.run(
          req({ bucket: "esign-documents", object_key: "admin/doc.pdf" }),
        ),
      (error: unknown) => {
        assert.equal(messageOf(error), "not_authorized");
        return true;
      },
    );
  });

  it("allows an esign document_storage_key that belongs to this rider", async () => {
    driverStorageDeps.requireRider = async () => rider();
    driverStorageDeps.getFirestore = () =>
      mockDb({
        [COLLECTIONS.esignRequests]: [
          {
            id: "sig-1",
            data: { driver_id: UID, document_storage_key: "admin/doc.pdf" },
          },
        ],
      }) as never;
    driverStorageDeps.getStorage = mockStorage() as never;
    const result = await driverGetDownloadUrl.run(
      req({ bucket: "esign-documents", object_key: "admin/doc.pdf" }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.url, "https://signed.example/esign-documents/admin/doc.pdf?a=read");
  });

  it("allows a request attachment on this rider's request", async () => {
    driverStorageDeps.requireRider = async () => rider();
    driverStorageDeps.getFirestore = () =>
      mockDb({
        [COLLECTIONS.requestAttachments]: [
          {
            id: "att-1",
            data: { storage_key: "staff/note.jpg", uploaded_by: "staff-1", request_id: "req-1" },
          },
        ],
        [COLLECTIONS.requests]: [{ id: "req-1", data: { driver_id: UID } }],
      }) as never;
    driverStorageDeps.getStorage = mockStorage() as never;
    const result = await driverGetDownloadUrl.run(
      req({ bucket: "request-attachments", object_key: "staff/note.jpg" }),
    );
    assert.equal(result.ok, true);
  });
});
