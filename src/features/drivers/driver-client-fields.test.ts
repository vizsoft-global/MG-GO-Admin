import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENT_ID_MAX_LENGTH,
  CLIENT_NAME_MAX_LENGTH,
  clientValueTooLong,
  normalizeClientValue,
} from "./driver-client-fields";
import { guessColumnMapping, mapRowsFromSheet } from "./import/parse";
import {
  DRIVER_IMPORT_COLUMNS,
  DRIVER_IMPORT_HEADERS,
  DRIVER_IMPORT_SAMPLE_ROW,
  resolveTemplateColumns,
  templateDriversAoa,
  templateGuideAoa,
} from "./import/template";
import { DRIVER_IMPORT_FIELDS, DRIVER_IMPORT_REQUIRED_FIELDS } from "./types";

describe("normalizeClientValue", () => {
  it("collapses every spelling of empty onto null", () => {
    assert.equal(normalizeClientValue(""), null);
    assert.equal(normalizeClientValue("   "), null);
    assert.equal(normalizeClientValue(null), null);
    assert.equal(normalizeClientValue(undefined), null);
  });

  it("trims but never truncates — the caller decides what to do with a long value", () => {
    assert.equal(normalizeClientValue("  CLI-204 "), "CLI-204");
    const long = "x".repeat(CLIENT_ID_MAX_LENGTH + 10);
    assert.equal(normalizeClientValue(long)?.length, CLIENT_ID_MAX_LENGTH + 10);
  });
});

describe("clientValueTooLong", () => {
  it("accepts a value exactly at the cap and refuses one past it", () => {
    assert.equal(clientValueTooLong(null, CLIENT_ID_MAX_LENGTH), false);
    assert.equal(
      clientValueTooLong("x".repeat(CLIENT_ID_MAX_LENGTH), CLIENT_ID_MAX_LENGTH),
      false,
    );
    assert.equal(
      clientValueTooLong("x".repeat(CLIENT_ID_MAX_LENGTH + 1), CLIENT_ID_MAX_LENGTH),
      true,
    );
    assert.equal(
      clientValueTooLong("x".repeat(CLIENT_NAME_MAX_LENGTH + 1), CLIENT_NAME_MAX_LENGTH),
      true,
    );
  });
});

describe("driver import template catalogue", () => {
  it("covers every mappable standard field exactly once", () => {
    const fields = DRIVER_IMPORT_COLUMNS.map((c) => c.field);
    assert.deepEqual([...fields].sort(), [...DRIVER_IMPORT_FIELDS].sort());
    assert.equal(new Set(fields).size, fields.length);
  });

  it("marks exactly the required fields as required", () => {
    const required = DRIVER_IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.field);
    assert.deepEqual([...required].sort(), [...DRIVER_IMPORT_REQUIRED_FIELDS].sort());
  });

  it("keeps headers and sample row positionally aligned", () => {
    assert.equal(DRIVER_IMPORT_HEADERS.length, DRIVER_IMPORT_SAMPLE_ROW.length);
    assert.equal(DRIVER_IMPORT_HEADERS.length, DRIVER_IMPORT_COLUMNS.length);
  });

  it("emits headers that guessColumnMapping maps back to their own field", () => {
    const mapping = guessColumnMapping([...DRIVER_IMPORT_HEADERS]);
    for (const column of DRIVER_IMPORT_COLUMNS) {
      assert.equal(
        mapping[column.field],
        column.header,
        `${column.field} did not round-trip through its own header`,
      );
    }
  });
});

describe("resolveTemplateColumns", () => {
  const custom = [
    { key: "shift_pref", label: "Shift", field_type: "select" as const, options: [
      { value: "am", label: "AM" },
      { value: "pm", label: "PM" },
    ] },
  ];

  it("returns every column, custom fields included, when nothing was chosen", () => {
    const all = resolveTemplateColumns(null, custom);
    assert.equal(all.length, DRIVER_IMPORT_COLUMNS.length + 1);
    assert.ok(all.some((c) => c.header === "Shift"));
  });

  it("keeps identity and the zone/restaurant pair when the operator ticked nothing", () => {
    const chosen = resolveTemplateColumns([], custom);
    const fields = chosen.map((c) => c.field).sort();
    assert.deepEqual(
      fields,
      ["employee_id", "full_name", "restaurant_ids", "zone_id"].sort(),
    );
    assert.ok(chosen.every((c) => c.pinned));
  });

  it("returns the ticked optional columns alongside the required ones", () => {
    const chosen = resolveTemplateColumns(["client_id", "cf:shift_pref"], custom);
    const fields = chosen.map((c) => c.field);
    assert.ok(fields.includes("client_id"));
    assert.ok(fields.includes("cf:shift_pref"));
    assert.ok(fields.includes("full_name"));
    assert.ok(!fields.includes("phone"));
  });

  it("describes a select custom field by its allowed option values", () => {
    const chosen = resolveTemplateColumns(["cf:shift_pref"], custom);
    const shift = chosen.find((c) => c.field === "cf:shift_pref");
    assert.match(shift!.allowed, /am, pm/);
  });

  it("gives every column an example the importer would accept", () => {
    const columns = resolveTemplateColumns(null, [
      ...custom,
      { key: "joined", label: "Joined", field_type: "date" as const, options: [] },
      { key: "notes", label: "Notes", field_type: "text" as const, options: [] },
    ]);
    // A select must not advertise a value outside its own option list, or the
    // sample row fails the very validation the Guide describes.
    const shift = columns.find((c) => c.field === "cf:shift_pref")!;
    assert.equal(shift.example, "am");
    assert.match(columns.find((c) => c.field === "cf:joined")!.example, /^\d{4}-\d{2}-\d{2}$/);
    // Free text has no representative value, so it stays blank rather than
    // inventing one an operator might paste in as real.
    assert.equal(columns.find((c) => c.field === "cf:notes")!.example, "");
  });
});

describe("templateGuideAoa", () => {
  it("documents one row per column with its required flag and example", () => {
    const columns = resolveTemplateColumns(["client_id"], []);
    const aoa = templateGuideAoa(columns);
    assert.deepEqual(aoa[0], ["Column", "Required", "Allowed values", "Example"]);
    assert.equal(aoa.length, columns.length + 1);

    const clientRow = aoa.find((row) => row[0] === "Client ID")!;
    assert.equal(clientRow[1], "Optional");
    assert.ok(clientRow[2].length > 0);

    const nameRow = aoa.find((row) => row[0] === "Full Name")!;
    assert.equal(nameRow[1], "Required");

    const zoneRow = aoa.find((row) => row[0] === "Zone")!;
    assert.equal(zoneRow[1], "If no restaurant");
    const restaurantRow = aoa.find((row) => row[0] === "Restaurant IDs")!;
    assert.equal(restaurantRow[1], "If no zone");
  });
});

describe("templateDriversAoa", () => {
  it("ships a restaurant-only row and a zone-only row", () => {
    const columns = resolveTemplateColumns(null, []);
    const aoa = templateDriversAoa(columns, {
      restaurant: "RST-0001",
      zone: "Hawalli",
    });
    assert.equal(aoa.length, 3);
    const headers = aoa[0]!;
    const restaurantOnly = aoa[1]!;
    const zoneOnly = aoa[2]!;
    const zoneAt = headers.indexOf("Zone");
    const restaurantAt = headers.indexOf("Restaurant IDs");
    assert.ok(zoneAt >= 0 && restaurantAt >= 0);
    assert.equal(restaurantOnly[restaurantAt], "RST-0001");
    assert.equal(restaurantOnly[zoneAt], "");
    assert.equal(zoneOnly[zoneAt], "Hawalli");
    assert.equal(zoneOnly[restaurantAt], "");
  });
});

describe("client columns through the sheet mapper", () => {
  it("maps Client ID and Client Name to their own fields, not to each other", () => {
    const headers = ["Full Name", "Employee ID", "Client ID", "Client Name"];
    const mapping = guessColumnMapping(headers);
    assert.equal(mapping.client_id, "Client ID");
    assert.equal(mapping.client_name, "Client Name");
  });

  it("leaves client name unmapped when only Client ID is present", () => {
    const mapping = guessColumnMapping(["Full Name", "Employee ID", "Client ID"]);
    assert.equal(mapping.client_id, "Client ID");
    assert.equal(mapping.client_name, undefined);
  });

  it("carries both cells onto the mapped row, blank becoming null", () => {
    const headers = ["Full Name", "Employee ID", "Client ID", "Client Name"];
    const rows = mapRowsFromSheet(
      headers,
      [
        ["Ahmed Ali", "12345", "CLI-204", "Gulf Retail Group"],
        ["Sara Noor", "12346", "", ""],
      ],
      guessColumnMapping(headers),
    );
    assert.equal(rows[0].client_id, "CLI-204");
    assert.equal(rows[0].client_name, "Gulf Retail Group");
    assert.equal(rows[1].client_id, null);
    assert.equal(rows[1].client_name, null);
  });

  it("keeps a row whose only content is a client column", () => {
    const headers = ["Full Name", "Client Name"];
    const rows = mapRowsFromSheet(
      headers,
      [["", "Gulf Retail Group"]],
      guessColumnMapping(headers),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].client_name, "Gulf Retail Group");
  });
});
