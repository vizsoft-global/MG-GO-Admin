import assert from "node:assert/strict";
import test from "node:test";
import {
  driverInPartner,
  driverInZone,
  driverStatusSelected,
  resolveImportHits,
  statusWantedSet,
} from "./notification-audience-match";

test("onboarding and inactive map onto the stored driver statuses", () => {
  const wanted = statusWantedSet(["onboarding", "inactive"]);
  assert.equal(driverStatusSelected("pending", wanted), true);
  assert.equal(driverStatusSelected("suspended", wanted), true);
  assert.equal(driverStatusSelected("Active", wanted), false);
});

test("a restaurant assignment counts as the rider's zone", () => {
  assert.equal(
    driverInZone({
      zoneId: null,
      assignmentZoneIds: ["zone-jahra"],
      wanted: new Set(["zone-jahra"]),
    }),
    true,
  );
  assert.equal(
    driverInZone({ zoneId: "other", assignmentZoneIds: [], wanted: new Set(["zone-jahra"]) }),
    false,
  );
});

test("project key matches a partner when partner_id is empty", () => {
  assert.equal(
    driverInPartner({
      partnerId: null,
      projectKey: "Keeta",
      assignmentPartnerIds: [],
      wantedIds: new Set(["partner-1"]),
      keysByPartnerId: new Map([["partner-1", ["keeta"]]]),
    }),
    true,
  );
});

test("import resolves a client id and skips a row that names two people", () => {
  const indexes = {
    byEmployeeId: new Map<string, string[]>([["10043", ["driver-a"]]]),
    byDriverCode: new Map<string, string[]>([["MG9", ["driver-b"]]]),
    byClientId: new Map<string, string[]>([["CL-7", ["driver-c"]]]),
  };
  const hits = resolveImportHits(
    [
      { employee_id: "CL-7" },
      { employee_id: "10043", driver_code: "MG9" },
    ],
    indexes,
  );
  assert.deepEqual(hits, ["driver-c"]);
});
