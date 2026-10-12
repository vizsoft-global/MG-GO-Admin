import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpsError } from "firebase-functions/v2/https";
import { dispatchAdminLane, type RouterAuth, type RouterRequest } from "./admin-api";

const CODES = [
  "unauthenticated",
  "permission-denied",
  "invalid-argument",
  "not-found",
  "failed-precondition",
  "resource-exhausted",
  "internal",
] as const;

const auth: RouterAuth = {
  uid: "staff-1",
  token: { staff: true, superAdmin: false, roleId: "role-1" },
};

function silence(run: () => Promise<void>): Promise<void> {
  const info = console.info;
  console.info = () => undefined;
  return run().finally(() => {
    console.info = info;
  });
}

describe("admin api dispatcher", () => {
  it("forwards auth.uid and claims unchanged", async () => {
    await silence(async () => {
      let seen: RouterRequest | undefined;
      const handler = (request: RouterRequest) => {
        seen = request;
        return request.auth?.uid;
      };
      const direct = handler({ auth, data: { limit: 1 } });
      const routed = await dispatchAdminLane(
        "light",
        { auth, data: { fn: "adminPerfPing", data: { limit: 1 } } },
        () => handler,
      );
      assert.equal(direct, "staff-1");
      assert.equal(routed, "staff-1");
      assert.ok(seen);
      assert.equal(seen.auth, auth);
      assert.equal(seen.auth?.token, auth.token);
      assert.deepEqual(seen.data, { limit: 1 });
    });
  });

  it("preserves HttpsError code, message, and details", async () => {
    await silence(async () => {
      for (const code of CODES) {
        const details = { code, n: 1 };
        const thrown = new HttpsError(code, `msg_${code}`, details);
        await assert.rejects(
          () =>
            dispatchAdminLane("light", { auth, data: { fn: "adminPerfPing", data: {} } }, () => {
              return () => {
                throw thrown;
              };
            }),
          (err: unknown) => {
            assert.equal(err, thrown);
            assert.ok(err instanceof HttpsError);
            assert.equal(err.code, code);
            assert.equal(err.message, `msg_${code}`);
            assert.deepEqual(err.details, details);
            return true;
          },
        );
      }
    });
  });

  it("maps a non-HttpsError to internal without logging the message", async () => {
    const sentinel = "payload-secret-do-not-log";
    const lines: string[] = [];
    const info = console.info;
    const warn = console.warn;
    const error = console.error;
    const log = console.log;
    const capture = (...args: unknown[]) => {
      lines.push(args.map((item) => String(item)).join(" "));
    };
    console.info = capture;
    console.warn = capture;
    console.error = capture;
    console.log = capture;
    try {
      await assert.rejects(
        () =>
          dispatchAdminLane(
            "light",
            { auth, data: { fn: "adminPerfPing", data: { secret: sentinel } } },
            () => () => {
              throw new Error(sentinel);
            },
          ),
        (err: unknown) => {
          assert.ok(err instanceof HttpsError);
          assert.equal(err.code, "internal");
          assert.equal(err.message, "INTERNAL");
          assert.equal(err.details, undefined);
          return true;
        },
      );
    } finally {
      console.info = info;
      console.warn = warn;
      console.error = error;
      console.log = log;
    }
    assert.equal(lines.some((line) => line.includes(sentinel)), false);
    assert.equal(lines.some((line) => line.includes('"perf":"router"')), true);
  });

  it("rejects an unknown function and a function on the wrong lane before loading it", async () => {
    await silence(async () => {
      let loads = 0;
      const loader = () => {
        loads += 1;
        return () => "no";
      };
      await assert.rejects(
        () => dispatchAdminLane("light", { data: { fn: "notARealFunction", data: {} } }, loader),
        (err: unknown) => err instanceof HttpsError && err.code === "not-found" && err.message === "unknown_fn",
      );
      await assert.rejects(
        () => dispatchAdminLane("light", { data: { fn: 12 } }, loader),
        (err: unknown) => err instanceof HttpsError && err.code === "not-found",
      );
      await assert.rejects(
        () => dispatchAdminLane("heavy", { data: { fn: "adminPerfPing", data: {} } }, loader),
        (err: unknown) =>
          err instanceof HttpsError && err.code === "failed-precondition" && err.message === "wrong_lane",
      );
      assert.equal(loads, 0);
    });
  });

  it("counts the in-flight request in the log", async () => {
    const lines: string[] = [];
    const info = console.info;
    console.info = (line?: unknown) => {
      lines.push(String(line));
    };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const first = dispatchAdminLane("light", { data: { fn: "adminPerfPing", data: {} } }, () => async () => {
        await gate;
        return "first";
      });
      const second = await dispatchAdminLane("scan", { data: { fn: "adminLiveFleetSnapshot", data: {} } }, () => () =>
        "second",
      );
      assert.equal(second, "second");
      release();
      assert.equal(await first, "first");
    } finally {
      console.info = info;
    }
    const parsed = lines.map((line) => JSON.parse(line) as { inflight: number; fn: string });
    assert.equal(parsed.some((line) => line.fn === "adminLiveFleetSnapshot" && line.inflight === 2), true);
  });
});
