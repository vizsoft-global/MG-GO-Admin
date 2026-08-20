import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPartnerIndex,
  buildRestaurantIndex,
  buildZoneIndex,
  resolvePartnerToken,
  resolveRestaurantTokens,
  resolveZoneToken,
} from "./resolve-lookups";

const PARTNER_A = { id: "11111111-1111-4111-8111-111111111111", name: "Talabat" };
const PARTNER_B = { id: "22222222-2222-4222-8222-222222222222", name: "Talabat" };
const UNIQUE = { id: "33333333-3333-4333-8333-333333333333", name: "Deliveroo" };

describe("resolvePartnerToken", () => {
  it("matches UUID then unique name", () => {
    const index = buildPartnerIndex([PARTNER_A, UNIQUE]);
    assert.equal(resolvePartnerToken(PARTNER_A.id, index).status, "ok");
    const byName = resolvePartnerToken("deliveroo", index);
    assert.equal(byName.status, "ok");
    if (byName.status === "ok") assert.equal(byName.id, UNIQUE.id);
  });

  it("flags ambiguous duplicate names", () => {
    const index = buildPartnerIndex([PARTNER_A, PARTNER_B]);
    assert.equal(resolvePartnerToken("Talabat", index).status, "ambiguous");
    assert.equal(resolvePartnerToken(PARTNER_A.id, index).status, "ok");
  });

  it("does not treat a missing UUID as a name", () => {
    const index = buildPartnerIndex([UNIQUE]);
    assert.equal(
      resolvePartnerToken("44444444-4444-4444-8444-444444444444", index).status,
      "unmatched",
    );
  });
});

describe("resolveZoneToken", () => {
  it("matches UUID, then unique code, then unique name", () => {
    const index = buildZoneIndex([
      { id: "55555555-5555-4555-8555-555555555555", name: "Hawalli", code: "HAW" },
      { id: "66666666-6666-4666-8666-666666666666", name: "Salmiya", code: "SAL" },
    ]);
    const byCode = resolveZoneToken("haw", index);
    assert.equal(byCode.status, "ok");
    if (byCode.status === "ok") assert.equal(byCode.name, "Hawalli");
    const byName = resolveZoneToken("Salmiya", index);
    assert.equal(byName.status, "ok");
  });
});

describe("resolveRestaurantTokens", () => {
  const r1 = {
    id: "77777777-7777-4777-8777-777777777777",
    name: "Crystal Tower",
    restaurant_code: "RST-0001",
  };
  const r2 = {
    id: "88888888-8888-4888-8888-888888888888",
    name: "Marina Mall",
    restaurant_code: "RST-0002",
  };

  it("accepts RST codes, UUIDs, and unique names", () => {
    const index = buildRestaurantIndex([r1, r2]);
    const mixed = resolveRestaurantTokens("RST-0001, Marina Mall", index);
    assert.equal(mixed.status, "ok");
    assert.deepEqual(mixed.ids, [r1.id, r2.id]);
  });

  it("returns unmatched when a token is unknown", () => {
    const index = buildRestaurantIndex([r1]);
    assert.equal(resolveRestaurantTokens("RST-9999", index).status, "unmatched");
  });

  it("returns empty when no restaurants are listed", () => {
    const index = buildRestaurantIndex([r1]);
    assert.equal(resolveRestaurantTokens("", index).status, "empty");
  });
});
