import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  PURGE_FILTER_COLUMN_LABELS,
  PURGE_FILTER_COLUMN_OVERRIDES,
  PURGE_FILTER_ENTITIES,
  PURGE_FILTER_VALUE_LABELS,
  countPurgeFilters,
  describePurgeFilter,
  formatPurgeDate,
  humaniseFilterKey,
  isPurgeDateRangeColumn,
  isPurgeFilterEntity,
  kuwaitYmdFromDate,
  parsePurgeDate,
  purgeFilterColumnLabelKey,
  purgeFilterColumnMessageKey,
  purgeFilterValueLabel,
  samePurgeFilters,
  sanitisePurgeFilters,
  type PurgeFilters,
} from "./purge-filter-catalog";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const MIGRATION = join(
  root,
  "supabase",
  "migrations",
  "20261117000000_purge_filtered.sql",
);

/* ------------------------------------------------------------------ */
/* The server is the source of `{key, kind}` — so this file proves the  */
/* client copy cannot drift from it.                                    */
/* ------------------------------------------------------------------ */

type ParsedEntity = {
  entity: string;
  columns: { key: string; kind: string }[];
};

/**
 * Read `admin_purge_filter_columns` out of the migration rather than trusting
 * a hand-copied list. The function is a flat `CASE` of `jsonb_build_array`, so
 * the shape is unambiguous: a `WHEN '<entity>'` opens a branch, `jsonb_build_object`
 * lines are its columns, and the branch closes on a bare `)`.
 */
function parseServerCatalogue(): ParsedEntity[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("FUNCTION public.admin_purge_filter_columns(");
  assert.ok(start >= 0, "migration has no admin_purge_filter_columns");
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, "admin_purge_filter_columns is not terminated");

  const entities: ParsedEntity[] = [];
  let current: ParsedEntity | null = null;

  for (const line of sql.slice(start, end).split(/\r?\n/)) {
    const when = /^\s*WHEN '([a-z0-9_]+)' THEN jsonb_build_array\($/.exec(line);
    if (when) {
      current = { entity: when[1], columns: [] };
      continue;
    }
    if (!current) continue;

    const column = /jsonb_build_object\('key', '([^']+)', 'kind', '([^']+)'\)/.exec(
      line,
    );
    if (column) {
      current.columns.push({ key: column[1], kind: column[2] });
      continue;
    }

    if (/^\s*\)\s*$/.test(line)) {
      entities.push(current);
      current = null;
    }
  }

  return entities;
}

const SERVER_CATALOGUE = parseServerCatalogue();

type Catalogue = Record<string, unknown>;

function loadMessages(locale: string): Catalogue {
  return JSON.parse(
    readFileSync(join(root, "src", "messages", `${locale}.json`), "utf8"),
  ) as Catalogue;
}

const CATALOGUES: Record<string, Catalogue> = {
  en: loadMessages("en"),
  ar: loadMessages("ar"),
};

/** Walks a dotted path. `undefined` means the key is genuinely absent. */
function lookup(catalogue: Catalogue, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object") {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, catalogue);
}

const FILTERED = "pages.settings.dataCleanup.filtered";

/* ------------------------------------------------------------------ */

describe("purge filter catalogue", () => {
  it("matches admin_purge_filter_columns key-for-key and kind-for-kind", () => {
    const expected = SERVER_CATALOGUE.map((entry) => ({
      entity: entry.entity,
      columns: entry.columns.map((column) => ({
        key: column.key,
        kind: column.kind,
      })),
    }));

    assert.ok(expected.length > 0, "nothing was parsed out of the migration");
    assert.deepEqual(
      PURGE_FILTER_ENTITIES.map((entry) => ({
        entity: entry.entity,
        columns: entry.columns.map((column) => ({
          key: column.key,
          kind: column.kind,
        })),
      })),
      expected,
      "the catalogue the dialog draws from has drifted away from the columns the matcher knows",
    );
  });

  it("advertises exactly the entities the server does", () => {
    const client = PURGE_FILTER_ENTITIES.map((entry) => entry.entity).sort();
    const server = SERVER_CATALOGUE.map((entry) => entry.entity).sort();
    assert.deepEqual(client, server);
    for (const entity of client) assert.equal(isPurgeFilterEntity(entity), true);
    assert.equal(isPurgeFilterEntity("driverss"), false);
  });

  it("every catalogued column resolves to a real label in both locales", () => {
    for (const entry of PURGE_FILTER_ENTITIES) {
      for (const column of entry.columns) {
        const relative = purgeFilterColumnLabelKey(entry.entity, column.key);
        assert.notEqual(
          relative,
          "",
          `${entry.entity}.${column.key} has no label key — the dialog would fall back to a humanised token`,
        );

        const messageKey = purgeFilterColumnMessageKey(entry.entity, column.key);
        assert.ok(messageKey, `${entry.entity}.${column.key} produced no message key`);
        assert.ok(
          messageKey.startsWith(`${FILTERED}.`),
          `${messageKey} is outside the filtered namespace`,
        );

        for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
          const value = lookup(catalogue, messageKey);
          assert.equal(
            typeof value,
            "string",
            `${locale}.json is missing ${messageKey}`,
          );
        }
      }
    }
  });

  it("gives every `date` column its own label, so none reads as a creation date", () => {
    for (const entry of PURGE_FILTER_ENTITIES) {
      const hasDate = entry.columns.some((column) => column.key === "date");
      if (!hasDate) continue;
      assert.ok(
        PURGE_FILTER_COLUMN_OVERRIDES[entry.entity]?.date,
        `${entry.entity} filters on \`date\` but has no override — it would render the shared "Date" label`,
      );
    }
  });

  it("keeps the label maps covering every key the catalogue uses", () => {
    for (const entry of PURGE_FILTER_ENTITIES) {
      for (const column of entry.columns) {
        // Either a per-entity override or a shared key — never neither.
        const override = PURGE_FILTER_COLUMN_OVERRIDES[entry.entity]?.[column.key];
        const shared =
          column.key in PURGE_FILTER_COLUMN_LABELS &&
          purgeFilterColumnLabelKey(entry.entity, column.key) !== "";
        assert.ok(
          Boolean(override) || shared,
          `${entry.entity}.${column.key} has no label entry at all`,
        );
      }
    }
  });

  it("has every value label the dialog can render", () => {
    const valueKeys = [...Object.keys(PURGE_FILTER_VALUE_LABELS), "empty"];
    for (const key of valueKeys) {
      for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
        const value = lookup(catalogue, `${FILTERED}.values.${key}`);
        assert.equal(
          typeof value,
          "string",
          `${locale}.json is missing ${FILTERED}.values.${key}`,
        );
      }
    }
  });

  it("has the chrome keys the panel and dialog always ask for", () => {
    const keys = [
      "button",
      "tab",
      "title",
      "subtitle",
      "bannerTitle",
      "bannerBody",
      "column",
      "columnPlaceholder",
      "loadingColumns",
      "noColumns",
      "value",
      "valuePlaceholder",
      "loadingValues",
      "noValues",
      "selectAll",
      "clear",
      "valueCount",
      "min",
      "max",
      "textPlaceholder",
      "addFilter",
      "clearDraft",
      "activeFilters",
      "noFilters",
      "editFilter",
      "matchCount",
      "reviewEmpty",
      "blockedBody",
      "deleteMatching",
      "cancel",
      "success",
      "confirmTitle",
      "confirmItemName",
      "confirmPhrase",
      "warning",
      "errors.emptyValue",
      "range.any",
      "panelBannerTitle",
      "panelBannerBody",
      "panelModule",
      "panelModulePlaceholder",
      "panelStart",
      "panelColumns",
    ];

    for (const key of keys) {
      for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
        const value = lookup(catalogue, `${FILTERED}.${key}`);
        assert.equal(
          typeof value,
          "string",
          `${locale}.json is missing ${FILTERED}.${key}`,
        );
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Filter shape                                                        */
/* ------------------------------------------------------------------ */

const DRIVER_COLUMNS = PURGE_FILTER_ENTITIES[0].columns;

const VEHICLE_COLUMNS = PURGE_FILTER_ENTITIES.find(
  (entry) => entry.entity === "vehicles",
)!.columns;

/** `driver` is the one `text` column in the wave-1 catalogue. */
const VEHICLE_DRIVER = VEHICLE_COLUMNS.find((column) => column.key === "driver")!;

describe("sanitisePurgeFilters", () => {
  it("drops a column the server does not advertise", () => {
    const filters: PurgeFilters = {
      zone: { in: ["zone-1"] },
      notAColumn: { contains: "x" },
    };
    assert.deepEqual(sanitisePurgeFilters(DRIVER_COLUMNS, filters), {
      zone: { in: ["zone-1"] },
    });
  });

  it("drops constraints left empty, because an empty `in` matches nothing", () => {
    const filters: PurgeFilters = {
      zone: { in: [] },
      companyName: { contains: "   " },
      todayDeliveries: {},
      status: { in: ["active"] },
    };
    assert.deepEqual(sanitisePurgeFilters(DRIVER_COLUMNS, filters), {
      status: { in: ["active"] },
    });
  });

  it("trims text, de-duplicates list values and keeps only real range bounds", () => {
    const filters: PurgeFilters = {
      driver: { contains: "  Acme  " },
      project: { in: ["talabat", "talabat", "deliveroo"] },
      year: { min: 3, max: Number.NaN },
    };
    assert.deepEqual(sanitisePurgeFilters(VEHICLE_COLUMNS, filters), {
      driver: { contains: "Acme" },
      project: { in: ["talabat", "deliveroo"] },
      year: { min: 3 },
    });
  });

  it("counts only the constraints that survive sanitising", () => {
    const filters: PurgeFilters = {
      zone: { in: ["zone-1"] },
      status: { in: [] },
      todayDeliveries: { min: 0 },
    };
    assert.equal(countPurgeFilters(sanitisePurgeFilters(DRIVER_COLUMNS, filters)), 2);
  });

  it("compares filters by content", () => {
    assert.equal(
      samePurgeFilters({ zone: { in: ["a"] } }, { zone: { in: ["a"] } }),
      true,
    );
    assert.equal(
      samePurgeFilters({ zone: { in: ["a"] } }, { zone: { in: ["b"] } }),
      false,
    );
    assert.equal(samePurgeFilters({}, { status: { in: ["active"] } }), false);
  });
});

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */

const t = ((key: string, values?: Record<string, unknown>) => {
  if (key === "values.empty") return "(empty)";
  if (key === "range.any") return "Any";
  if (key === "valueCount") return `${values?.count} selected`;
  if (key.startsWith("values.")) {
    const token = key.slice("values.".length);
    return token.charAt(0).toUpperCase() + token.slice(1);
  }
  return key;
}) as unknown as Parameters<typeof describePurgeFilter>[0];

describe("filter labels and summaries", () => {
  it("humanises a camelCase token rather than painting it raw", () => {
    assert.equal(humaniseFilterKey("scopeType"), "Scope type");
    assert.equal(humaniseFilterKey("doc_type"), "Doc type");
    assert.equal(humaniseFilterKey("status"), "Status");
  });

  it("prefers a real server label and translates only UI words", () => {
    assert.equal(purgeFilterValueLabel(t, "", "ignored"), "(empty)");
    assert.equal(purgeFilterValueLabel(t, "in_transit", "In transit"), "In transit");
    // A server label that is just the token adds nothing, so it falls through.
    assert.equal(purgeFilterValueLabel(t, "active", "active"), "Active");
    assert.equal(purgeFilterValueLabel(t, "on_hold"), "On hold");
  });

  it("summarises each kind of constraint for the chips", () => {
    const zone = DRIVER_COLUMNS.find((column) => column.key === "zone")!;
    const deliveries = DRIVER_COLUMNS.find(
      (column) => column.key === "todayDeliveries",
    )!;

    assert.equal(describePurgeFilter(t, zone, { in: ["Jahra"] }), "Jahra");
    assert.equal(
      describePurgeFilter(t, zone, { in: ["Jahra", "Hawalli", "Farwaniya"] }),
      "3 selected",
    );
    assert.equal(describePurgeFilter(t, VEHICLE_DRIVER, { contains: "Acme" }), "Acme");
    assert.equal(
      describePurgeFilter(t, deliveries, { min: 3, max: 9 }),
      "3 – 9",
    );
    assert.equal(describePurgeFilter(t, deliveries, { min: 3 }), "3 – Any");
  });

  it("only `date` gets calendars; a count column gets numbers", () => {
    const date = PURGE_FILTER_ENTITIES.find((e) => e.entity === "deliveries")!
      .columns.find((column) => column.key === "date")!;
    const deliveries = DRIVER_COLUMNS.find(
      (column) => column.key === "todayDeliveries",
    )!;

    assert.equal(isPurgeDateRangeColumn(date), true);
    assert.equal(isPurgeDateRangeColumn(deliveries), false);

    assert.equal(
      describePurgeFilter(t, date, { min: 20261001, max: 20261005 }),
      "2026-10-01 – 2026-10-05",
    );
    assert.equal(describePurgeFilter(t, date, {}), "Any – Any");
  });

  it("round-trips a Kuwait date between the picker and the RPC scalar", () => {
    // 21:30Z is already 00:30 the next day in Kuwait (UTC+3) — the exact case a
    // UTC-derived date would put on the wrong operational day.
    const ymd = kuwaitYmdFromDate(new Date("2026-10-05T21:30:00Z"));
    assert.equal(ymd, 20261006);
    assert.equal(formatPurgeDate(ymd), "2026-10-06");
    assert.equal(parsePurgeDate("2026-10-06"), ymd);
    assert.equal(parsePurgeDate("2026-10"), null);
    assert.equal(parsePurgeDate(""), null);
    // A malformed scalar passes through as text rather than reading as a date.
    assert.equal(formatPurgeDate(20261), "20261");
  });
});
