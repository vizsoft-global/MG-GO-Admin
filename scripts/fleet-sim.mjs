/**
 * fleet-sim — synthetic driver simulator for Live Tracking V2.
 *
 * Proving 500 moving drivers at 60fps, a zone flip, an offline burst and an
 * overspeed run needs 500 phones, or it needs this. Every scenario is scripted,
 * so hysteresis can be tested deliberately instead of waited for.
 *
 * Run it with tsx, because it imports the real status machine, wire format and
 * Worker rules rather than a copy of them — a simulator that agrees with a copy
 * proves nothing:
 *
 *   node --import tsx scripts/fleet-sim.mjs --help
 *
 * Three targets, in increasing order of how much real infrastructure they touch:
 *
 *   --target ws     (default) Local WebSocket server speaking the admin wire
 *                   protocol. Point the app at it with
 *                   FLEET_WS_URL=ws://localhost:8787 and any
 *                   FLEET_WS_TOKEN_SECRET. No Cloudflare, no database, no writes.
 *                   This is the render-performance rig.
 *   --target room   Runs the real FleetRoom in this process with Supabase stubbed
 *                   at the fetch boundary, and reports whether one single-threaded
 *                   room absorbs the fleet at the requested cadence. This is the
 *                   1Hz capacity rig; it needs no tokens and no infrastructure.
 *   --target edge   POST /ingest against a real Worker as real drivers. Needs a
 *                   --tokens file of driver JWTs. Exercises the DO, the rules and
 *                   the durable flush end to end.
 *   --target db     Calls admin_ingest_driver_positions with the service role.
 *                   WRITES TO THE DATABASE and moves pins on the v1 page too, so
 *                   it demands --confirm.
 */

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";

import {
  FLEET_EVENT_KEYS,
  fleetThresholdsAsSettings,
  resolveFleetThresholds,
} from "../src/features/live-tracking-v2/fleet-status.ts";
import { encodePosition } from "../src/features/live-tracking-v2/fleet-wire.ts";
import { evaluateRules, initialRuleState } from "../infra/workers/dpd-live/src/fleet-rules.ts";
import { verifyAdminToken } from "../infra/workers/dpd-live/src/auth.ts";
import { debouncedMembership } from "../infra/workers/dpd-live/src/geo.ts";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const HELP = `fleet-sim — synthetic driver simulator for Live Tracking V2

Usage: node --import tsx scripts/fleet-sim.mjs [options]

  --target ws|room|edge|db
                        Where positions go (default ws)
  --drivers N           Synthetic drivers (default 500, ws target only)
  --hz N                Delta frames per second (default 4)
  --cadence MS          Simulated GPS fix interval (default 1000 — the app's
                        moving cadence; pass 5000 for the pre-1Hz behaviour)
  --batch N             Fixes per ingest request for --target room (default 2,
                        matching LiveCadence.batchSize in the app)
  --port N              WS listen port (default 8787)
  --room NAME           Room name announced in hello (default fleet-kw)
  --duration S          Stop after S seconds (default: run until Ctrl-C)
  --speed N             Simulated-time multiplier (default 1; 10 = ten minutes
                        of fleet behaviour per minute of wall clock)
  --scenarios LIST      e.g. overspeed=5,zone-flip=5,offline-burst=3
  --seed N              PRNG seed (default 42) — same seed, same fleet
  --url URL             Worker origin for --target edge
  --tokens FILE         JSON { "<driver uuid>": "<driver jwt>" } for --target edge
  --confirm             Required by --target db (it writes to production)
  --report-every S      Print the event/frame report every S seconds (default 15)
  --help

Scenarios (each is a scripted timeline, not random noise):
  cruise          steady loop at ~35 km/h (default for unassigned drivers)
  overspeed       climbs past the limit for 60s every 3 min
  speed-flap      oscillates 58/62 km/h every fix — must emit overspeed once
  zone-flip       leaves and re-enters its assigned zone every 90s
  boundary-flap   hovers on the zone edge every fix — must emit zone.exit once
  offline-burst   stops reporting for 3 min every 6 min
  low-battery     drains to 12%
  battery-flap    oscillates 19/21% — must emit battery.low once
  idle            parks for 10 min, then moves again
  delivery        idle -> moving -> on delivery -> delivered, repeating
`;

const SCENARIOS = [
  "cruise",
  "overspeed",
  "speed-flap",
  "zone-flip",
  "boundary-flap",
  "offline-burst",
  "low-battery",
  "battery-flap",
  "idle",
  "delivery",
];

function parseArgs(argv) {
  const args = {
    target: "ws",
    drivers: 500,
    hz: 4,
    // The app's moving interval. Was 5000 before the 1Hz change, and a simulator
    // whose default disagrees with the app measures a fleet nobody ships.
    cadence: 1000,
    batch: 2,
    port: 8787,
    room: "fleet-kw",
    duration: 0,
    speed: 1,
    seed: 42,
    scenarios: {},
    url: process.env.FLEET_WS_URL ?? "",
    tokens: "",
    confirm: false,
    reportEvery: 15,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    switch (key) {
      case "--help":
      case "-h":
        console.log(HELP);
        process.exit(0);
        break;
      case "--target":
        args.target = value;
        i += 1;
        break;
      case "--drivers":
        args.drivers = Number(value);
        i += 1;
        break;
      case "--hz":
        args.hz = Number(value);
        i += 1;
        break;
      case "--batch":
        args.batch = Number(value);
        i += 1;
        break;
      case "--cadence":
        args.cadence = Number(value);
        i += 1;
        break;
      case "--port":
        args.port = Number(value);
        i += 1;
        break;
      case "--room":
        args.room = value;
        i += 1;
        break;
      case "--duration":
        args.duration = Number(value);
        i += 1;
        break;
      case "--speed":
        args.speed = Number(value);
        i += 1;
        break;
      case "--seed":
        args.seed = Number(value);
        i += 1;
        break;
      case "--url":
        args.url = value;
        i += 1;
        break;
      case "--tokens":
        args.tokens = value;
        i += 1;
        break;
      case "--report-every":
        args.reportEvery = Number(value);
        i += 1;
        break;
      case "--confirm":
        args.confirm = true;
        break;
      case "--scenarios":
        for (const pair of String(value).split(",")) {
          const [name, count] = pair.split("=");
          if (!SCENARIOS.includes(name)) {
            fail(`unknown scenario "${name}". Known: ${SCENARIOS.join(", ")}`);
          }
          args.scenarios[name] = Number(count ?? 1);
        }
        i += 1;
        break;
      default:
        if (key.startsWith("--")) fail(`unknown option ${key}`);
    }
  }

  if (!["ws", "edge", "db", "room"].includes(args.target)) {
    fail(`--target must be ws, edge, room or db`);
  }
  if (args.batch < 1) fail("--batch must be at least 1");
  if (args.target === "db" && !args.confirm) {
    fail("--target db writes to the production database. Re-run with --confirm.");
  }
  return args;
}

function fail(message) {
  console.error(`fleet-sim: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fleet generation
// ---------------------------------------------------------------------------

/** Deterministic PRNG: a load test that cannot be reproduced is an anecdote. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Kuwait City and the governorates a real fleet actually covers. */
const HUBS = [
  { name: "Kuwait City", lat: 29.3759, lng: 47.9774 },
  { name: "Hawally", lat: 29.3033, lng: 48.0289 },
  { name: "Salmiya", lat: 29.3394, lng: 48.0758 },
  { name: "Farwaniya", lat: 29.2775, lng: 47.9589 },
  { name: "Jahra", lat: 29.3375, lng: 47.6581 },
  { name: "Ahmadi", lat: 29.0769, lng: 48.0838 },
  { name: "Fahaheel", lat: 29.0826, lng: 48.1305 },
  { name: "Mangaf", lat: 29.0972, lng: 48.1339 },
];

const METERS_PER_DEG_LAT = 111_320;
const ZONE_RADIUS_M = 2200;

function metersPerDegLng(lat) {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

function uuidFrom(seed, index) {
  const hex = createHash("sha1").update(`${seed}:${index}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

function buildZones() {
  return HUBS.map((hub, index) => {
    const dLat = ZONE_RADIUS_M / METERS_PER_DEG_LAT;
    const dLng = ZONE_RADIUS_M / metersPerDegLng(hub.lat);
    return {
      id: uuidFrom("zone", index),
      name: `${hub.name} Zone`,
      color: null,
      zoneType: "circle",
      ring: null,
      center: [hub.lng, hub.lat],
      radiusMeters: ZONE_RADIUS_M,
      bbox: [hub.lng - dLng, hub.lat - dLat, hub.lng + dLng, hub.lat + dLat],
    };
  });
}

function assignScenarios(count, requested, random) {
  const assigned = new Array(count).fill("cruise");
  let cursor = 0;
  for (const [name, n] of Object.entries(requested)) {
    for (let i = 0; i < n && cursor < count; i += 1, cursor += 1) {
      assigned[cursor] = name;
    }
  }
  // Nothing requested: sprinkle one of each so a plain run still exercises every
  // rule, which is what makes `--report` meaningful without arguments.
  if (cursor === 0) {
    for (const name of SCENARIOS.slice(1)) {
      const slot = Math.min(count - 1, Math.floor(random() * count));
      assigned[slot] = name;
    }
  }
  return assigned;
}

function buildFleet(args, zones) {
  const random = mulberry32(args.seed);
  const scenarios = assignScenarios(args.drivers, args.scenarios, random);
  const drivers = [];

  for (let i = 0; i < args.drivers; i += 1) {
    const zone = zones[i % zones.length];
    const [zoneLng, zoneLat] = zone.center;
    // Loop radius inside the zone so a cruising driver stays compliant; the
    // zone-flip scenario is what deliberately leaves.
    const radiusM = 400 + random() * (ZONE_RADIUS_M - 900);
    drivers.push({
      idIdx: i + 1,
      driverId: uuidFrom(args.seed, i),
      driverName: `Sim Driver ${String(i + 1).padStart(4, "0")}`,
      driverCode: String(10000 + i),
      employeeId: String(90000 + i),
      zoneId: zone.id,
      zoneName: zone.name,
      scenario: scenarios[i],
      homeLat: zoneLat,
      homeLng: zoneLng,
      radiusM,
      phase: random() * Math.PI * 2,
      // ~25–45 km/h cruise, the honest range for a scooter in traffic.
      cruiseMps: 7 + random() * 5,
      direction: random() < 0.5 ? 1 : -1,
      batteryPct: 55 + Math.floor(random() * 45),
      deliveriesToday: Math.floor(random() * 14),
      distanceTodayMeters: Math.floor(random() * 60_000),
      rules: initialRuleState(),
      // Filled by the motion model each fix.
      lat: zoneLat,
      lng: zoneLng,
      speedMps: 0,
      headingDeg: 0,
      trackingStatus: "idle",
      activeDeliveryId: null,
      lastFixAtMs: null,
      reporting: true,
      isMocked: false,
    });
  }
  return drivers;
}

// ---------------------------------------------------------------------------
// Motion + scenarios
// ---------------------------------------------------------------------------

const KMH = 1 / 3.6;

/**
 * Advances one driver to simulated time `tMs`.
 *
 * Position comes from a closed loop rather than a random walk: a random walk
 * cannot be interpolated, so it would flatter the client's dead reckoning
 * instead of testing it.
 */
function stepDriver(driver, tMs, thresholds) {
  const tSec = tMs / 1000;
  const scenario = driver.scenario;
  driver.reporting = true;
  driver.isMocked = false;

  let speedMps = driver.cruiseMps;
  let radiusM = driver.radiusM;
  let tracking = "moving";
  let activeDeliveryId = null;

  switch (scenario) {
    case "overspeed": {
      // 60s above the limit every 3 minutes, well clear of the threshold so the
      // 3-sample confirmation is reached.
      const inBurst = tSec % 180 < 60;
      speedMps = inBurst ? (thresholds.overspeedKmh + 18) * KMH : driver.cruiseMps;
      break;
    }
    case "speed-flap": {
      // Straddles the limit on every fix. Correct behaviour is exactly one
      // overspeed.start, because 3 consecutive samples above are never reached.
      // Starts *below* the limit: a driver seeded already speeding would be a
      // baseline, and the rule would suppress the event for the right reason but
      // prove nothing about hysteresis.
      const above = Math.floor(tSec / 5) % 2 === 1;
      speedMps = (thresholds.overspeedKmh + (above ? 2 : -2)) * KMH;
      break;
    }
    case "zone-flip": {
      // 90s out, 90s in. Radius crosses the zone edge by a clear margin so the
      // buffer cannot absorb it.
      const outside = tSec % 180 < 90;
      radiusM = outside ? ZONE_RADIUS_M + 600 : driver.radiusM;
      break;
    }
    case "boundary-flap": {
      // Sits on the edge, alternating a few metres either side of it: inside the
      // hysteresis buffer, so the correct outcome is no zone event at all after
      // the first verdict. Starts inside, so "no event" is a decision the rule
      // made rather than the state it was seeded in.
      const out = Math.floor(tSec / 5) % 2 === 1;
      radiusM = ZONE_RADIUS_M + (out ? 8 : -8);
      break;
    }
    case "offline-burst": {
      // Reports for 3 minutes, vanishes for 3. gps.offline should fire once per
      // burst, gps.restored once per return.
      driver.reporting = tSec % 360 < 180;
      break;
    }
    case "low-battery": {
      // 1% per simulated minute, floor 12.
      driver.batteryPct = Math.max(12, 60 - Math.floor(tSec / 60));
      break;
    }
    case "battery-flap": {
      // Starts above the limit for the same reason as the other flap scenarios.
      const low = Math.floor(tSec / 5) % 2 === 1;
      driver.batteryPct = thresholds.lowBatteryPct + (low ? -1 : 1);
      break;
    }
    case "idle": {
      // 10 minutes parked, then 5 moving. idle.sustained fires once per park.
      const parked = tSec % 900 < 600;
      speedMps = parked ? 0 : driver.cruiseMps;
      tracking = parked ? "idle" : "moving";
      break;
    }
    case "delivery": {
      // 4-minute cycle: 2 min riding, 1 min at the restaurant, 1 min delivering.
      const phase = tSec % 240;
      if (phase < 120) {
        tracking = "moving";
      } else if (phase < 180) {
        speedMps = 0;
        tracking = "idle";
      } else {
        tracking = "delivery_submit";
        activeDeliveryId = uuidFrom(`${driver.driverId}:delivery`, Math.floor(tSec / 240));
      }
      break;
    }
    default:
      break;
  }

  if (speedMps < 1.5) tracking = tracking === "delivery_submit" ? tracking : "idle";

  // Angular velocity from linear speed keeps the loop physically plausible: a
  // fixed angular rate would make wide loops supersonic.
  const circumference = 2 * Math.PI * Math.max(radiusM, 1);
  const angle =
    driver.phase + driver.direction * ((speedMps * tSec) / circumference) * Math.PI * 2;

  const dLat = (Math.sin(angle) * radiusM) / METERS_PER_DEG_LAT;
  const dLng = (Math.cos(angle) * radiusM) / metersPerDegLng(driver.homeLat);

  driver.lat = driver.homeLat + dLat;
  driver.lng = driver.homeLng + dLng;
  driver.speedMps = speedMps;
  driver.headingDeg = Math.round(((angle * 180) / Math.PI + 90) % 360);
  driver.trackingStatus = tracking;
  driver.activeDeliveryId = activeDeliveryId;
  if (driver.reporting) driver.lastFixAtMs = Date.now();
  return driver;
}

function signalsFor(driver, zones, thresholds) {
  const zone = zones.find((z) => z.id === driver.zoneId);
  let inAssignedZone = null;
  if (zone) {
    // Through the Worker's own hysteresis, not a bare radius comparison: a raw
    // verdict would hand the rules a flap they never see in production and the
    // boundary-flap scenario would be testing the cooldown instead of the buffer.
    inAssignedZone = debouncedMembership(
      driver.lat,
      driver.lng,
      zone,
      driver.inAssignedZone ?? null,
      thresholds.zoneBufferMeters,
    );
    driver.inAssignedZone = inAssignedZone;
  }
  return {
    isBlocked: false,
    accountStatus: "active",
    isOnDuty: true,
    isOnline: true,
    locationOff: false,
    lastFixAtMs: driver.lastFixAtMs,
    trackingStatus: driver.trackingStatus,
    speedMps: driver.speedMps,
    activeDeliveryId: driver.activeDeliveryId,
    batteryPct: driver.batteryPct,
    isMocked: driver.isMocked,
    inAssignedZone,
    rangeStatus: inAssignedZone === false ? "out_of_zone" : "in_zone",
    shiftScheduledStartMs: null,
    shiftScheduledEndMs: null,
    shiftCheckInAtMs: null,
  };
}

// ---------------------------------------------------------------------------
// Minimal RFC 6455 server
//
// Deliberately dependency-free: adding `ws` to the admin app's package.json for
// a dev script would ship a runtime dependency to production.
// ---------------------------------------------------------------------------

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKey(key) {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

function encodeTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Yields complete client frames from a rolling buffer. */
function* readFrames(state) {
  while (true) {
    const buffer = state.buffer;
    if (buffer.length < 2) return;
    const opcode = buffer[0] & 0x0f;
    const masked = (buffer[1] & 0x80) !== 0;
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return;
      length = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }
    const maskLength = masked ? 4 : 0;
    if (buffer.length < offset + maskLength + length) return;
    const mask = masked ? buffer.subarray(offset, offset + 4) : null;
    const payload = Buffer.from(
      buffer.subarray(offset + maskLength, offset + maskLength + length),
    );
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }
    state.buffer = buffer.subarray(offset + maskLength + length);
    yield { opcode, payload };
  }
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

async function runWsTarget(args, fleet, zones, stats) {
  const thresholds = resolveFleetThresholds(null);
  const secret = process.env.FLEET_WS_TOKEN_SECRET?.trim();
  const sockets = new Set();

  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, sim: true, drivers: fleet.length }));
  });

  server.on("upgrade", async (req, socket) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const key = req.headers["sec-websocket-key"];
    if (url.pathname !== "/ws" || typeof key !== "string") {
      socket.destroy();
      return;
    }

    // Verified with the Worker's own function when a secret is configured, so a
    // token the simulator accepts is a token the Worker would accept.
    if (secret) {
      const token = url.searchParams.get("token") ?? "";
      const payload = await verifyAdminToken(secret, token);
      if (!payload) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    socket.setNoDelay(true);

    const state = { buffer: Buffer.alloc(0) };
    sockets.add(socket);
    stats.sockets = sockets.size;

    const send = (frame) => {
      if (!socket.writableEnded) socket.write(encodeTextFrame(JSON.stringify(frame)));
    };

    send({
      t: "hello",
      v: 1,
      room: args.room,
      serverTime: Date.now(),
      frameHz: args.hz,
      settings: fleetThresholdsAsSettings(thresholds),
      zones,
    });

    // One meta frame for the whole roster. The real DO sends these incrementally;
    // sending them at once here is the harder case for the client, not the easier.
    send({
      t: "meta",
      drivers: fleet.map((driver) => ({
        idIdx: driver.idIdx,
        driverId: driver.driverId,
        driverName: driver.driverName,
        driverCode: driver.driverCode,
        employeeId: driver.employeeId,
        avatarObjectKey: null,
        avatarUpdatedAt: null,
        zoneId: driver.zoneId,
        zoneName: driver.zoneName,
        partnerId: null,
        partnerName: "Sim Partner",
        restaurantName: null,
        vehicleLabel: "Scooter",
        vehicleTypeKey: "bike",
        accountStatus: "active",
        onDutySince: new Date(Date.now() - 3 * 3600_000).toISOString(),
        deliveriesToday: driver.deliveriesToday,
        deliveriesCompletedToday: Math.max(0, driver.deliveriesToday - 1),
        distanceTodayMeters: driver.distanceTodayMeters,
        batteryPct: driver.batteryPct,
        accuracyMeters: 8,
        activeDeliveryId: null,
        currentZoneId: driver.zoneId,
        currentZoneName: driver.zoneName,
        shiftStartAt: null,
        shiftEndAt: null,
        lastFixAt: new Date().toISOString(),
      })),
    });

    socket.on("data", (chunk) => {
      state.buffer = Buffer.concat([state.buffer, chunk]);
      for (const frame of readFrames(state)) {
        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
        if (frame.opcode === 0x9) {
          socket.write(Buffer.concat([Buffer.from([0x8a, 0]), Buffer.alloc(0)]));
          continue;
        }
        if (frame.opcode !== 0x1) continue;
        try {
          const message = JSON.parse(frame.payload.toString("utf8"));
          if (message.t === "ping") send({ t: "pong", ts: Date.now() });
          // `view` frames are acknowledged by ignoring them: interest management
          // is the Worker's optimisation, and a simulator that culled would hide
          // the client's worst case rather than testing it.
          if (message.t === "view") stats.viewFrames += 1;
        } catch {
          /* ignore malformed client frame */
        }
      }
    });

    const drop = () => {
      sockets.delete(socket);
      stats.sockets = sockets.size;
    };
    socket.on("close", drop);
    socket.on("error", drop);
  });

  await new Promise((resolve, reject) => {
    server.once("error", (error) =>
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `port ${args.port} is already in use — an earlier fleet-sim is probably still running.` +
                ` Stop it, or pass --port with a free port.`,
            )
          : error,
      ),
    );
    server.listen(args.port, resolve);
  });
  console.log(
    `fleet-sim: ws://localhost:${args.port}/ws — ${fleet.length} drivers, ${args.hz}Hz` +
      `${secret ? " (token verification on)" : " (no FLEET_WS_TOKEN_SECRET: tokens accepted unverified)"}`,
  );
  console.log(
    `fleet-sim: point the app at it with FLEET_WS_URL=ws://localhost:${args.port} and FLEET_ROOM=${args.room}`,
  );

  const broadcast = (frame) => {
    const buffer = encodeTextFrame(JSON.stringify(frame));
    stats.bytes += buffer.length * Math.max(sockets.size, 1);
    for (const socket of sockets) {
      if (!socket.writableEnded) socket.write(buffer);
    }
  };

  return {
    sendDelta(seq, tuples) {
      broadcast({ t: "delta", seq, ts: Date.now(), e: tuples, gone: [] });
    },
    sendEvents(events) {
      broadcast({ t: "events", events });
    },
    async close() {
      for (const socket of sockets) socket.end();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function loadTokens(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`could not read --tokens ${path}: ${error}`);
  }
}

function pointPayload(driver) {
  return {
    lat: driver.lat,
    lng: driver.lng,
    speed_mps: driver.speedMps,
    accuracy_m: 8,
    heading_deg: driver.headingDeg,
    // A moving simulated driver always has a real course; the field exists so the
    // room's normalisation is exercised rather than inferred.
    heading_source: driver.speedMps >= 1 ? "gps" : "compass",
    battery_pct: driver.batteryPct,
    altitude_m: 12,
    network_type: "cellular",
    charging_state: "discharging",
    is_mocked: driver.isMocked,
    location_provider: "sim",
    active_delivery_id: driver.activeDeliveryId,
    tracking_status: driver.trackingStatus,
    client_ts: new Date().toISOString(),
    replay: false,
  };
}

function runEdgeTarget(args, fleet, stats) {
  if (!args.url) fail("--target edge needs --url (the Worker origin)");
  if (!args.tokens) fail("--target edge needs --tokens (driver JWTs by driver id)");
  const tokens = loadTokens(args.tokens);
  const endpoint = `${args.url.replace(/\/+$/, "")}/ingest`;

  // Only drivers we hold a token for can be simulated: the Worker resolves the
  // driver from the JWT, which is exactly the property we want to keep.
  const usable = fleet.filter((driver) => tokens[driver.driverId]);
  if (usable.length === 0) {
    fail("no driver in --tokens matched a simulated driver id. Use --seed to match a previous run, or supply real ids.");
  }
  console.log(`fleet-sim: POST ${endpoint} for ${usable.length} drivers`);

  return {
    drivers: usable,
    async publish(driver) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokens[driver.driverId]}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ points: [pointPayload(driver)] }),
        });
        if (!response.ok) stats.errors += 1;
        else stats.published += 1;
      } catch {
        stats.errors += 1;
      }
    },
  };
}

/**
 * Runs the real `FleetRoom` in this process and measures what one room costs.
 *
 * The risk 1Hz introduces is not bandwidth, it is that a Durable Object is
 * **single-threaded**: 500 riders at 1Hz is ~250 batched ingest requests a second
 * through one object that evaluates rules on each. `--target edge` cannot answer
 * that — it needs 500 real driver JWTs, and it would be measuring Cloudflare's
 * network as much as the room. So the room is instantiated directly and Supabase
 * is replaced at the `fetch` boundary, which is the only thing between it and the
 * outside world. What is measured is therefore the same code path production runs,
 * minus workerd's I/O; what is *not* measured is the platform's own request
 * overhead, and the report says so rather than implying otherwise.
 */
async function runRoomTarget(args, fleet, zones, stats) {
  const { FleetRoom } = await import("../infra/workers/dpd-live/src/fleet-room.ts");

  const supabaseUrl = "https://sim.invalid";
  const snapshotDrivers = fleet.map((driver) => ({
    driver_id: driver.driverId,
    driver_name: driver.driverName,
    driver_code: driver.driverCode,
    employee_id: driver.employeeId,
    zone_id: driver.zoneId,
    zone_name: driver.zoneName,
    partner_id: null,
    partner_name: null,
    vehicle_type: "bike",
    is_on_duty: true,
    is_online: true,
    is_blocked: false,
    account_status: "active",
    latitude: driver.homeLat,
    longitude: driver.homeLng,
    speed_mps: 0,
    heading_deg: null,
    accuracy_meters: 10,
    battery_pct: driver.batteryPct,
    is_mocked: false,
    tracking_status: "idle",
    active_delivery_id: null,
    zone_status: "in_zone",
    last_report_at: new Date().toISOString(),
    deliveries_today: driver.deliveriesToday,
    distance_today_meters: driver.distanceTodayMeters,
    shift_start_at: null,
    shift_end_at: null,
    shift_check_in_at: null,
  }));

  const zoneRows = zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    color: zone.color ?? "#2563eb",
    zone_type: "circle",
    geometry: { type: "circle", center: zone.center, radius: ZONE_RADIUS_M },
  }));

  const io = { flushCalls: 0, flushRows: 0, eventRows: 0, broadcasts: 0, unhandled: [] };

  // Token → driver id, so `resolveUserFromToken` behaves like the real thing
  // (including the room's token cache) without a Supabase project.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith(supabaseUrl)) return realFetch(input, init);
    const path = url.slice(supabaseUrl.length);

    if (path.startsWith("/auth/v1/user")) {
      const header =
        (init?.headers && (init.headers.Authorization ?? init.headers.authorization)) ?? "";
      const id = String(header).replace(/^Bearer\s+sim\./, "");
      return jsonResponse(id ? { id } : {}, id ? 200 : 401);
    }
    if (path.startsWith("/rest/v1/rpc/admin_live_fleet_snapshot")) {
      return jsonResponse({ settings: null, drivers: snapshotDrivers });
    }
    if (path.startsWith("/rest/v1/rpc/admin_ingest_driver_positions")) {
      io.flushCalls += 1;
      const body = JSON.parse(init?.body ?? "{}");
      io.flushRows += Array.isArray(body.p_events) ? body.p_events.length : 0;
      return jsonResponse({});
    }
    if (path.startsWith("/rest/v1/zones")) return jsonResponse(zoneRows);
    if (path.startsWith("/rest/v1/rpc/admin_record_fleet_events")) {
      const body = JSON.parse(init?.body ?? "{}");
      io.eventRows += Array.isArray(body.p_events) ? body.p_events.length : 1;
      return jsonResponse({});
    }
    if (path.startsWith("/rest/v1/driver_operation_events")) return jsonResponse([]);
    if (path.startsWith("/realtime/v1/api/broadcast")) {
      io.broadcasts += 1;
      return jsonResponse({});
    }
    // Anything unstubbed is reported rather than silently returning [], which
    // would make a missing dependency look like an empty table.
    if (io.unhandled.length < 5) io.unhandled.push(path.split("?")[0]);
    return jsonResponse([]);
  };

  const storage = new Map();
  const state = {
    storage: {
      get: async (key) => storage.get(key),
      put: async (key, value) => void storage.set(key, value),
      delete: async (key) => storage.delete(key),
      setAlarm: async () => {},
      deleteAlarm: async () => {},
    },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    blockConcurrencyWhile: async (fn) => fn(),
    waitUntil: () => {},
  };

  const room = new FleetRoom(state, {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: "sim-service-role",
    SUPABASE_ANON_KEY: "sim-anon",
    ADMIN_WS_TOKEN_SECRET: "sim-secret",
    POSITION_FRAME_HZ: String(args.hz),
    TICK_MS: "2000",
    FLEET_ROOM: null,
  });

  console.log(
    `fleet-sim: in-process FleetRoom, ${fleet.length} riders, batch ${args.batch}, cadence ${args.cadence}ms`,
  );

  /** Per-driver buffer, mirroring the app's publisher. */
  const pending = new Map();

  return {
    io,
    /**
     * Latency of one ingest request, in ms, as the room experiences it.
     *
     * Returns the **summed** room time for the batch, which is the number that
     * decides capacity: the wall time of this loop also contains the harness
     * building 500 payloads, work production does on 500 separate phones.
     */
    async publishBatch(drivers) {
      let roomMs = 0;
      for (const driver of drivers) {
        // Buffer the way `LivePositionPublisher` does. Sending `batch` copies of
        // every fix instead would double the request rate the room sees — 500/s
        // rather than the 250/s the app actually produces — and that difference is
        // the whole question of whether one room is enough.
        let points = pending.get(driver.driverId);
        if (!points) {
          points = [];
          pending.set(driver.driverId, points);
        }
        points.push(pointPayload(driver));
        if (points.length < args.batch) continue;
        pending.set(driver.driverId, []);

        const startedNs = process.hrtime.bigint();
        const response = await room.fetch(
          new Request("https://sim.invalid/ingest", {
            method: "POST",
            headers: {
              Authorization: `Bearer sim.${driver.driverId}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ points, duty_state_version: 1 }),
          }),
        );
        const elapsedMs = Number(process.hrtime.bigint() - startedNs) / 1e6;
        roomMs += elapsedMs;
        stats.ingestMs.push(elapsedMs);
        if (stats.ingestMs.length > 5000) stats.ingestMs.shift();
        if (response.ok) stats.published += points.length;
        else {
          stats.errors += 1;
          if (stats.errors <= 3) {
            console.error("fleet-sim: ingest rejected", response.status, await response.text());
          }
        }
      }
      return roomMs;
    },
    async close() {
      globalThis.fetch = realFetch;
    },
  };
}

/**
 * The verdict the plan asked for: does **one** room absorb this fleet at this
 * cadence, with the headroom to spare?
 *
 * The number that decides it is not the mean ingest latency, it is total CPU time
 * per fix tick against the tick interval. A room that needs 1.2s to absorb one
 * second of fleet falls behind forever, however good its p50 looks.
 */
function reportRoom(room, stats, args, elapsedSec) {
  const percentile = (values, p) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };

  const tickBudgetMs = Math.max(250, args.cadence / args.speed);
  const tickP95 = percentile(stats.tickMs, 0.95);
  const load = tickBudgetMs > 0 ? tickP95 / tickBudgetMs : 0;
  const requestsPerSec = elapsedSec > 0 ? stats.published / args.batch / elapsedSec : 0;

  console.log(
    [
      `  room: ingest p50=${percentile(stats.ingestMs, 0.5).toFixed(3)}ms`,
      `p95=${percentile(stats.ingestMs, 0.95).toFixed(3)}ms`,
      `max=${percentile(stats.ingestMs, 1).toFixed(2)}ms`,
      `req/s=${requestsPerSec.toFixed(0)}`,
      `room_cpu p50=${percentile(stats.tickMs, 0.5).toFixed(0)}ms`,
      `p95=${tickP95.toFixed(0)}ms/${tickBudgetMs.toFixed(0)}ms`,
      `load=${(load * 100).toFixed(0)}%`,
    ].join(" "),
  );
  console.log(
    [
      `  durable: flushes=${room.io.flushCalls}`,
      `rows=${room.io.flushRows}`,
      `rows/driver/min=${
        elapsedSec > 0 ? ((room.io.flushRows / args.drivers / elapsedSec) * 60).toFixed(1) : "0"
      }`,
      `events=${room.io.eventRows}`,
      `mirrors=${room.io.broadcasts}`,
    ].join(" "),
  );

  const verdict =
    load < 0.5 ? "HOLDS" : load < 0.85 ? "TIGHT" : "SHARD FLEET_ROOM";
  console.log(
    `  verdict: ${verdict} — one room, ${args.drivers} riders on a ${args.cadence}ms cadence.` +
      " Excludes workerd request overhead and real network.",
  );
  if (room.io.unhandled.length > 0) {
    console.log(`  unstubbed Supabase paths (measurement is incomplete): ${room.io.unhandled.join(", ")}`);
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function runDbTarget(args, stats) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    fail("--target db needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  console.log("fleet-sim: WRITING to admin_ingest_driver_positions — this moves pins on BOTH pages");

  return {
    async publishBatch(drivers) {
      const events = drivers.map((driver) => ({
        driver_id: driver.driverId,
        ...pointPayload(driver),
      }));
      try {
        const response = await fetch(`${url}/rest/v1/rpc/admin_ingest_driver_positions`, {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ p_events: events }),
        });
        if (!response.ok) {
          stats.errors += 1;
          if (stats.errors <= 3) console.error("fleet-sim: rpc failed", await response.text());
        } else {
          stats.published += events.length;
        }
      } catch (error) {
        stats.errors += 1;
        if (stats.errors <= 3) console.error("fleet-sim: rpc threw", String(error));
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const zones = buildZones();
  const fleet = buildFleet(args, zones);
  const thresholds = resolveFleetThresholds(null);

  const stats = {
    frames: 0,
    fixes: 0,
    bytes: 0,
    sockets: 0,
    viewFrames: 0,
    published: 0,
    errors: 0,
    events: new Map(),
    byScenario: new Map(),
    encodeMs: [],
    ingestMs: [],
    tickMs: [],
    startedAt: Date.now(),
  };

  const scenarioCounts = new Map();
  for (const driver of fleet) {
    scenarioCounts.set(driver.scenario, (scenarioCounts.get(driver.scenario) ?? 0) + 1);
  }
  console.log(
    `fleet-sim: ${fleet.length} drivers, seed ${args.seed}, ${
      args.speed !== 1 ? `${args.speed}x simulated time, ` : ""
    }scenarios ${[...scenarioCounts].map(([k, v]) => `${k}=${v}`).join(" ")}`,
  );

  const ws = args.target === "ws" ? await runWsTarget(args, fleet, zones, stats) : null;
  const edge = args.target === "edge" ? runEdgeTarget(args, fleet, stats) : null;
  const db = args.target === "db" ? runDbTarget(args, stats) : null;
  const room =
    args.target === "room" ? await runRoomTarget(args, fleet, zones, stats) : null;
  const active = edge ? edge.drivers : fleet;

  const startedAt = Date.now();
  let seq = 0;
  let stopping = false;

  const simTime = () => (Date.now() - startedAt) * args.speed;

  /** One simulated GPS fix for every driver, plus rule evaluation. */
  const fixTick = async () => {
    const tMs = simTime();
    const drafts = [];

    for (const driver of active) {
      stepDriver(driver, tMs, thresholds);
      if (!driver.reporting) continue;
      stats.fixes += 1;

      const outcome = evaluateRules(driver.rules, {
        signals: signalsFor(driver, zones, thresholds),
        assignedZoneId: driver.zoneId,
        latitude: driver.lat,
        longitude: driver.lng,
        nowMs: Date.now(),
        thresholds: null,
      });
      driver.rules = outcome.state;
      driver.status = outcome.status;
      driver.flags = outcome.flags;

      for (const event of outcome.events) {
        stats.events.set(event.eventKey, (stats.events.get(event.eventKey) ?? 0) + 1);
        // Per scenario as well as per key: a global count cannot tell a flap
        // driver's event from the 20 drivers deliberately speeding next to it,
        // which is what made the first version of this report cry wolf.
        const scoped = `${driver.scenario}|${event.eventKey}`;
        stats.byScenario.set(scoped, (stats.byScenario.get(scoped) ?? 0) + 1);
        drafts.push({
          driverId: driver.driverId,
          eventKey: event.eventKey,
          severity: event.severity,
          value: event.value,
          statusBefore: event.statusBefore,
          statusAfter: event.statusAfter,
          zoneId: event.zoneId,
          latitude: event.latitude,
          longitude: event.longitude,
          context: event.context,
          detectedAt: event.detectedAt,
        });
      }

      if (edge) await edge.publish(driver);
    }

    if (db) {
      // One RPC for the whole fleet: 500 round trips per tick would measure the
      // simulator's network stack, not the database.
      await db.publishBatch(active.filter((driver) => driver.reporting));
    }
    if (room) {
      // Sequential on purpose. A Durable Object handles one request at a time, so
      // firing 500 in parallel would measure Promise scheduling and hide the very
      // serialisation this target exists to measure.
      const roomMs = await room.publishBatch(active.filter((driver) => driver.reporting));
      stats.tickMs.push(roomMs);
      if (stats.tickMs.length > 600) stats.tickMs.shift();
    }
    if (ws && drafts.length > 0) ws.sendEvents(drafts);
  };

  /** Position frame, independent of the fix cadence exactly as in production. */
  const frameTick = () => {
    if (!ws) return;
    const startedNs = process.hrtime.bigint();
    const nowMs = Date.now();
    const tuples = [];
    for (const driver of active) {
      if (driver.lastFixAtMs == null || !driver.status) continue;
      tuples.push(
        encodePosition({
          idIdx: driver.idIdx,
          lat: driver.lat,
          lng: driver.lng,
          speedMps: driver.speedMps,
          headingDeg: driver.headingDeg,
          status: driver.status,
          flags: driver.flags,
          ageMs: nowMs - driver.lastFixAtMs,
        }),
      );
    }
    seq += 1;
    ws.sendDelta(seq, tuples);
    stats.frames += 1;
    stats.encodeMs.push(Number(process.hrtime.bigint() - startedNs) / 1e6);
    if (stats.encodeMs.length > 600) stats.encodeMs.shift();
  };

  const report = () => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const sorted = [...stats.encodeMs].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    const perFrame = stats.frames ? stats.bytes / stats.frames : 0;
    console.log(
      [
        `t=${elapsed.toFixed(0)}s`,
        `frames=${stats.frames}`,
        `fixes=${stats.fixes}`,
        args.target === "ws"
          ? `sockets=${stats.sockets} kb/frame=${(perFrame / 1024).toFixed(1)} encode_p95=${p95.toFixed(2)}ms`
          : `published=${stats.published} errors=${stats.errors}`,
      ].join(" "),
    );
    if (room) reportRoom(room, stats, args, elapsed);
    if (stats.events.size > 0) {
      console.log(
        `  events: ${[...stats.events]
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => `${key}=${count}`)
          .join(" ")}`,
      );
    }
  };

  const fixTimer = setInterval(() => {
    void fixTick();
  }, Math.max(250, args.cadence / args.speed));
  const frameTimer = ws ? setInterval(frameTick, Math.round(1000 / args.hz)) : null;
  const reportTimer = setInterval(report, Math.max(1, args.reportEvery) * 1000);

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(fixTimer);
    if (frameTimer) clearInterval(frameTimer);
    clearInterval(reportTimer);
    report();
    printExpectations(stats, scenarioCounts, args);
    if (ws) await ws.close();
    if (room) await room.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  if (args.duration > 0) setTimeout(() => void shutdown(), args.duration * 1000);

  await fixTick();
  frameTick();
}

/**
 * The hysteresis contract, checked rather than described.
 *
 * The flap scenarios exist to prove a rule fires *once*; if the counts scale with
 * the number of oscillations, hysteresis is broken and this is where it shows.
 */
function printExpectations(stats, scenarioCounts, args) {
  const flapDrivers =
    (scenarioCounts.get("speed-flap") ?? 0) +
    (scenarioCounts.get("boundary-flap") ?? 0) +
    (scenarioCounts.get("battery-flap") ?? 0);
  if (flapDrivers === 0) return;

  console.log("\nfleet-sim: hysteresis check (flap scenarios must not scale with oscillations)");
  const rows = [
    ["speed-flap", FLEET_EVENT_KEYS.overspeedStart, scenarioCounts.get("speed-flap") ?? 0, 60_000],
    ["boundary-flap", FLEET_EVENT_KEYS.zoneExit, scenarioCounts.get("boundary-flap") ?? 0, 120_000],
    ["battery-flap", FLEET_EVENT_KEYS.batteryLow, scenarioCounts.get("battery-flap") ?? 0, 30 * 60_000],
  ];
  const elapsedMs = Date.now() - stats.startedAt;
  for (const [scenario, key, drivers, cooldownMs] of rows) {
    if (drivers === 0) continue;
    const emitted = stats.byScenario.get(`${scenario}|${key}`) ?? 0;
    // The budget is per cooldown window, not per run. Asserting "at most one per
    // driver" made every run longer than a cooldown cry wolf — which is the same
    // false alarm the per-scenario tally was introduced to remove.
    const windows = Math.max(1, Math.ceil(elapsedMs / cooldownMs));
    const allowed = drivers * windows;
    const verdict = emitted <= allowed ? "OK" : "SUSPECT";
    console.log(
      `  ${scenario}: ${key} emitted ${emitted} for ${drivers} driver(s) over ${windows} × ${
        cooldownMs / 1000
      }s cooldown — ${verdict}` +
        (verdict === "SUSPECT" ? ` (expected at most ${allowed})` : ""),
    );
  }
  if (args.speed > 1) {
    console.log(
      `  note: --speed ${args.speed} compresses simulated time, but cooldowns are wall-clock,` +
        " so scenario counts below are floors, not steady-state rates.",
    );
  }
}

await main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
