import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetSentryApiCache,
  driverIdToSentryUserId,
  getSentryDeviceOverview,
  isSentryConfigured,
  sentryBuildIssuesUrl,
  sentryDriverIssuesUrl,
  sentryUserIdToDriverId,
} from "./sentry-api";

const DRIVER_ID = "3f1c2b4a-9d8e-4f7a-b6c5-1a2b3c4d5e6f";
const DRIVER_ID_HEX = "3f1c2b4a9d8e4f7ab6c51a2b3c4d5e6f";

test("sentryUserIdToDriverId accepts the dashed uuid the app sends", () => {
  assert.equal(sentryUserIdToDriverId(DRIVER_ID), DRIVER_ID);
});

test("sentryUserIdToDriverId re-dashes a 32-char hex id", () => {
  assert.equal(sentryUserIdToDriverId(DRIVER_ID_HEX), DRIVER_ID);
});

test("sentryUserIdToDriverId is case-insensitive and trims", () => {
  assert.equal(sentryUserIdToDriverId(`  ${DRIVER_ID.toUpperCase()} `), DRIVER_ID);
});

test("sentryUserIdToDriverId strips an `id:` scalar prefix", () => {
  assert.equal(sentryUserIdToDriverId(`id:${DRIVER_ID}`), DRIVER_ID);
});

test("sentryUserIdToDriverId rejects anything that is not a uuid", () => {
  // An email or a driver code in the user pill must not be read as a driver id:
  // a wrong join here attributes one rider's crashes to another.
  for (const value of ["", "   ", "10042", "rider@example.com", DRIVER_ID.slice(0, -1)]) {
    assert.equal(sentryUserIdToDriverId(value), null, value);
  }
  assert.equal(sentryUserIdToDriverId(null), null);
  assert.equal(sentryUserIdToDriverId(undefined), null);
});

test("driverIdToSentryUserId round-trips with sentryUserIdToDriverId", () => {
  const wire = driverIdToSentryUserId(DRIVER_ID);
  assert.equal(wire, DRIVER_ID);
  assert.equal(sentryUserIdToDriverId(wire), DRIVER_ID);
});

test("driverIdToSentryUserId refuses a non-uuid rather than building a bad query", () => {
  assert.equal(driverIdToSentryUserId("10042"), null);
  assert.equal(driverIdToSentryUserId(null), null);
});

test("deep links quote the value so a query cannot be broken by it", () => {
  const url = sentryDriverIssuesUrl(DRIVER_ID);
  assert.ok(url);
  assert.ok(url.includes(encodeURIComponent(`user.id:"${DRIVER_ID}"`)));
  assert.ok(sentryBuildIssuesUrl(85).includes(encodeURIComponent('dist:"85"')));
});

test("sentryDriverIssuesUrl returns null for an id it cannot map", () => {
  assert.equal(sentryDriverIssuesUrl("not-a-uuid"), null);
});

test("an unconfigured token reports disconnected instead of throwing", async () => {
  const previous = process.env.SENTRY_API_TOKEN;
  delete process.env.SENTRY_API_TOKEN;
  __resetSentryApiCache();
  try {
    assert.equal(isSentryConfigured(), false);
    const overview = await getSentryDeviceOverview();
    assert.equal(overview.connected, false);
    assert.equal(overview.connected === false && overview.reason, "not_configured");
  } finally {
    if (previous === undefined) delete process.env.SENTRY_API_TOKEN;
    else process.env.SENTRY_API_TOKEN = previous;
    __resetSentryApiCache();
  }
});

test("a failing Sentry call degrades to disconnected, never to a throw", async () => {
  const previousToken = process.env.SENTRY_API_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.SENTRY_API_TOKEN = "test-token";
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  __resetSentryApiCache();
  try {
    const overview = await getSentryDeviceOverview();
    assert.equal(overview.connected, false);
    assert.equal(overview.connected === false && overview.reason, "request_failed");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.SENTRY_API_TOKEN;
    else process.env.SENTRY_API_TOKEN = previousToken;
    __resetSentryApiCache();
  }
});

test("a 401 is reported as unauthorized so the panel can name the cause", async () => {
  const previousToken = process.env.SENTRY_API_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.SENTRY_API_TOKEN = "test-token";
  globalThis.fetch = (async () =>
    new Response("{}", { status: 401 })) as unknown as typeof fetch;
  __resetSentryApiCache();
  try {
    const overview = await getSentryDeviceOverview();
    assert.equal(overview.connected === false && overview.reason, "unauthorized");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.SENTRY_API_TOKEN;
    else process.env.SENTRY_API_TOKEN = previousToken;
    __resetSentryApiCache();
  }
});

test("build and driver rows are parsed, and duplicate user rows fold into one driver", async () => {
  const previousToken = process.env.SENTRY_API_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.SENTRY_API_TOKEN = "test-token";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const body = url.includes("field=dist")
      ? {
          data: [
            { dist: "85", release: "1.1.20+85", "count()": 12, "count_unique(user)": 4 },
            { dist: null, release: null, "count()": 3, "count_unique(user)": 1 },
          ],
        }
      : {
          data: [
            { "user.id": DRIVER_ID, "count()": 7, "count_unique(issue)": 2 },
            { "user.id": DRIVER_ID_HEX, "count()": 5, "count_unique(issue)": 1 },
            { "user.id": "rider@example.com", "count()": 99, "count_unique(issue)": 9 },
          ],
        };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  __resetSentryApiCache();
  try {
    const overview = await getSentryDeviceOverview();
    assert.equal(overview.connected, true);
    if (!overview.connected) return;
    assert.deepEqual(
      overview.builds.map((b) => [b.versionCode, b.events, b.users]),
      [
        [85, 12, 4],
        [null, 3, 1],
      ],
    );
    assert.equal(overview.drivers.length, 1);
    assert.deepEqual(overview.drivers[0], { driverId: DRIVER_ID, events: 12, issues: 3 });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.SENTRY_API_TOKEN;
    else process.env.SENTRY_API_TOKEN = previousToken;
    __resetSentryApiCache();
  }
});
