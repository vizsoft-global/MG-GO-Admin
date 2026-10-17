import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, setFirestoreFactoryForTests } from "../core/fs";
import {
  measureBlock,
  setFsMetricsClassesForTests,
  type FsMetricClasses,
} from "../core/fs-metrics";
import { requireStaff } from "../core/staff";

class FakeQuery {
  get(): Promise<{ size: number }> {
    return Promise.resolve({ size: 2 });
  }
}

class FakeAggregate {
  get(): Promise<{ data: () => { count: number } }> {
    return Promise.resolve({ data: () => ({ count: 1 }) });
  }
}

function classesWithoutAggregate(): FsMetricClasses {
  return {
    Query: FakeQuery,
    AggregateQuery: undefined,
  };
}

/**
 * The installed fake must answer every read `requireStaff` makes: it reads the
 * profile and the `auth_epochs/current` counter in one `getAll`.
 */
function fakeDb() {
  const missing = { exists: false, data: () => undefined };
  return {
    collection() {
      return {
        doc() {
          return {
            async get() {
              return missing;
            },
          };
        },
      };
    },
    async getAll(...refs: unknown[]) {
      return refs.map(() => missing);
    },
  };
}

const staffRequest = {
  auth: { uid: "staff-test", token: {} },
  data: {},
} as CallableRequest<unknown>;

describe("fs metrics install", () => {
  after(() => {
    setFsMetricsClassesForTests(null);
    setFirestoreFactoryForTests(null);
  });

  it("skips a missing AggregateQuery and still serves getFirestore and requireStaff", async () => {
    const aggregateGet = FakeAggregate.prototype.get;
    setFsMetricsClassesForTests(classesWithoutAggregate);
    setFirestoreFactoryForTests(() => fakeDb() as ReturnType<typeof getFirestore>);

    const db = getFirestore();
    assert.equal(typeof db.collection, "function");
    assert.equal(FakeAggregate.prototype.get, aggregateGet);

    await assert.rejects(
      () => requireStaff(staffRequest, "drivers.view"),
      (error: unknown) => {
        assert.ok(error instanceof HttpsError);
        assert.equal(error.code, "permission-denied");
        assert.equal(error.message, "not_authorized");
        return true;
      },
    );

    const { metrics } = await measureBlock("missing-aggregate", async () => {
      await new FakeQuery().get();
    });
    assert.equal(metrics.reads, 1);
    assert.equal(metrics.docsRead, 2);
  });

  it("disables metrics once when patching throws and leaves the request path up", () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (line?: unknown) => {
      lines.push(String(line));
    };
    let loads = 0;
    try {
      setFirestoreFactoryForTests(() => fakeDb() as ReturnType<typeof getFirestore>);
      setFsMetricsClassesForTests(() => {
        loads += 1;
        throw new Error("patch failed");
      });
      assert.equal(typeof getFirestore().collection, "function");
      assert.equal(typeof getFirestore().collection, "function");
      assert.equal(loads, 1);
      assert.deepEqual(lines, ["fs-metrics disabled: patch failed"]);
    } finally {
      console.error = original;
      setFsMetricsClassesForTests(null);
      setFirestoreFactoryForTests(null);
    }
  });
});
