import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fieldSearchMatch } from "../../components/app/app-list-controls/search-match";
import { LIST_SEARCH_DEBOUNCE_MS, listSearchDelayMs } from "./list-search";

type Row = {
  name: string;
  mgId: string;
  clientId: string;
  phone: string;
  civilId: string;
  restaurant: string;
  zone: string;
  status: string;
};

const accessors = {
  name: (row: Row) => row.name,
  mg_id: (row: Row) => row.mgId,
  client_id: (row: Row) => row.clientId,
  phone: (row: Row) => row.phone,
  civil_id: (row: Row) => row.civilId,
  restaurant: (row: Row) => row.restaurant,
  zone: (row: Row) => row.zone,
};

const rows: Row[] = [
  {
    name: "Nasser Al Hamra",
    mgId: "108899",
    clientId: "CLI-270",
    phone: "96598765432",
    civilId: "285010112345",
    restaurant: "Keeta - Jahra",
    zone: "Jahra",
    status: "active",
  },
  {
    name: "Jenson Doe",
    mgId: "10088",
    clientId: "C-2",
    phone: "96512345678",
    civilId: "290020298765",
    restaurant: "Americana - Salmiya",
    zone: "Hawally",
    status: "active",
  },
  {
    name: "Omar Farooq",
    mgId: "10001",
    clientId: "CLI-18",
    phone: "96555500011",
    civilId: "275030377889",
    restaurant: "Americana - Farwaniya",
    zone: "Farwaniya",
    status: "suspended",
  },
];

function search(query: string): Row[] {
  return rows.filter((row) => fieldSearchMatch(row, query, accessors));
}

describe("list search timing", () => {
  it("debounces a typed query by 150ms", () => {
    assert.equal(LIST_SEARCH_DEBOUNCE_MS, 150);
    assert.equal(listSearchDelayMs("N"), 150);
    assert.equal(listSearchDelayMs("Ali Hawally"), 150);
    assert.equal(listSearchDelayMs("  nas  "), 150);
  });

  it("applies a cleared box immediately so the full table returns on the click", () => {
    assert.equal(listSearchDelayMs(""), 0);
    assert.equal(listSearchDelayMs("   "), 0);
  });
});

describe("instant list search", () => {
  it("answers a single character with no minimum length", () => {
    const hits = search("k");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.name, "Nasser Al Hamra");
    // The same letter in a name is found too — one letter is a real query.
    assert.deepEqual(
      search("j").map((row) => row.mgId),
      ["108899", "10088"],
    );
  });

  it("matches case-insensitively on a partial substring, including the middle of a word", () => {
    assert.deepEqual(
      search("nAsSeR").map((row) => row.mgId),
      ["108899"],
    );
    assert.deepEqual(
      search("Hamra").map((row) => row.mgId),
      ["108899"],
    );
    assert.deepEqual(
      search("awal").map((row) => row.mgId),
      ["10088"],
    );
  });

  it("searches every primary column at once", () => {
    assert.deepEqual(search("CLI-270").map((row) => row.mgId), ["108899"]);
    assert.deepEqual(search("98765432").map((row) => row.mgId), ["108899"]);
    assert.deepEqual(search("290020298765").map((row) => row.mgId), ["10088"]);
    assert.deepEqual(search("Salmiya").map((row) => row.mgId), ["10088"]);
    assert.deepEqual(search("Farwaniya").map((row) => row.mgId), ["10001"]);
  });

  it("requires every typed token to match somewhere, across different columns", () => {
    assert.deepEqual(
      search("jenson hawally").map((row) => row.mgId),
      ["10088"],
    );
    // "Jenson" is a name and "CLI-270" a client id on a different rider.
    assert.equal(search("jenson CLI-270").length, 0);
  });

  it("combines with an active dropdown filter instead of replacing it", () => {
    const activeOnly = rows.filter((row) => row.status === "active");
    const narrowed = activeOnly.filter((row) => fieldSearchMatch(row, "americana", accessors));
    assert.deepEqual(
      narrowed.map((row) => row.mgId),
      ["10088"],
    );
    // The same term reaches a suspended rider once the status filter is off.
    assert.deepEqual(
      search("americana").map((row) => row.mgId),
      ["10088", "10001"],
    );
  });

  it("restores the full dataset when the query is cleared", () => {
    assert.equal(search("farwaniya").length, 1);
    assert.equal(search("").length, rows.length);
  });
});
