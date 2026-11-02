/**
 * Service Type catalog — seed preview (READ ONLY).
 *
 * Reads the client's `Service type.xlsx`, applies the SAME dedupe / slug /
 * category rules the import dialog and `service-types.ts` already use, and
 * writes a local report. It writes nothing to Firestore and changes nothing.
 *
 *   node --import tsx scripts/service-types-seed-preview.mjs --xlsx "<path>"
 *
 * Options:
 *   --xlsx <path>   workbook (default: Service type.xlsx in the repo root)
 *   --sheet <name>  worksheet (default: Sheet1 when it exists, else the first)
 *   --out <path>    JSON report (default: .qa/fleet-service/service-types-seed-preview.json)
 *   --md <path>     human report (default: alongside the JSON, .md)
 *
 * Every source row keeps its Excel row number, and nothing is renamed or dropped
 * from the report: blank rows, duplicates and unmapped names are all listed with
 * the row they came from.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import * as XLSX from "xlsx";
import {
  categoryForServiceType,
  normaliseServiceTypeName,
  serviceTypeKey,
} from "../src/features/fleet/service/service-types.ts";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const root = process.cwd();
const workbookPath = resolve(root, arg("xlsx", "Service type.xlsx"));
const outPath = resolve(root, arg("out", ".qa/fleet-service/service-types-seed-preview.json"));
const mdPath = resolve(root, arg("md", outPath.replace(/\.json$/i, "") + ".md"));

let buffer;
try {
  buffer = readFileSync(workbookPath);
} catch {
  console.error(`Sheet not found: ${workbookPath}`);
  process.exit(1);
}

const workbook = XLSX.read(buffer, { type: "buffer" });
const wantedSheet = arg(
  "sheet",
  workbook.SheetNames.includes("Sheet1") ? "Sheet1" : workbook.SheetNames[0],
);
const sheetName = workbook.SheetNames.includes(wantedSheet) ? wantedSheet : workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
if (!sheet) {
  console.error(`Worksheet not found: ${wantedSheet}`);
  process.exit(1);
}

/** Used range, so a blank row inside it is visible rather than skipped. */
function usedRange(ref) {
  if (!ref) return { firstRow: 1, lastRow: 0, firstCol: 0, lastCol: -1 };
  const range = XLSX.utils.decode_range(ref);
  return {
    firstRow: range.s.r + 1,
    lastRow: range.e.r + 1,
    firstCol: range.s.c,
    lastCol: range.e.c,
  };
}

const range = usedRange(sheet["!ref"]);
const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true, defval: null });
const cellText = (value) => (value == null ? "" : String(value));

const headerRow = grid[0] ?? [];
const headerLooksLikeName =
  typeof headerRow[0] === "string" && /service\s*type/i.test(headerRow[0]);
const startIndex = headerLooksLikeName ? 1 : 0;

const rows = [];
const duplicates = [];
const invalid = [];
const seen = new Map();
const unique = [];

for (let i = startIndex; i < grid.length; i += 1) {
  const row = grid[i] ?? [];
  const text = cellText(row[0]);
  const sheetRow = (range.firstRow ?? 1) + i;
  const labelEn = text.replace(/\s+/g, " ").trim();

  // Columns the sheet carries beyond the name — reported, never silently dropped.
  const hasExtraCells = row.slice(1).some((value) => cellText(value).trim() !== "");

  if (labelEn === "") {
    rows.push({ sheetRow, rawName: text === "" ? null : text, status: "blank", hasExtraCells });
    continue;
  }

  const normalised = normaliseServiceTypeName(labelEn);
  const key = serviceTypeKey(labelEn);
  const category = categoryForServiceType(labelEn);
  const previous = seen.get(normalised) ?? seen.get(key);
  const base = { sheetRow, rawName: text, labelEn, key, category, hasExtraCells };

  if (previous) {
    rows.push({ ...base, status: "duplicate", duplicateOfRow: previous.sheetRow });
    duplicates.push({
      sheetRow,
      name: labelEn,
      key,
      duplicateOfRow: previous.sheetRow,
      duplicateOfName: previous.labelEn,
      matchedOn: previous.normalised === normalised ? "normalised name" : "key",
    });
    continue;
  }

  seen.set(normalised, { sheetRow, labelEn, normalised });
  seen.set(key, { sheetRow, labelEn, normalised });

  const reasons = [];
  const slug = normalised.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (key === "service_type") reasons.push("no latin letters or digits in the name -> fallback key");
  if (slug.length > 60) reasons.push("key truncated at 60 characters");
  if (/[^\x20-\x7e]/.test(labelEn)) reasons.push("non-ASCII characters in the name");

  const item = { ...base, status: reasons.length ? "invalid" : "ok", reasons };
  rows.push(item);
  unique.push(item);
  if (reasons.length) invalid.push({ sheetRow, name: labelEn, key, reasons });
}
const categoryCounts = {};
for (const item of unique) categoryCounts[item.category] = (categoryCounts[item.category] ?? 0) + 1;

const unmapped = unique
  .filter((item) => item.category === "other")
  .map((item) => ({ sheetRow: item.sheetRow, name: item.labelEn, key: item.key }));

const blankRows = rows.filter((row) => row.status === "blank");
const extraColumnRows = rows.filter((row) => row.hasExtraCells);

const report = {
  generatedAt: new Date().toISOString(),
  source: basename(workbookPath),
  sourcePath: workbookPath,
  sheet: sheetName,
  sheetNames: workbook.SheetNames,
  usedRange: sheet["!ref"] ?? null,
  headerRow: headerLooksLikeName ? headerRow.map(cellText) : null,
  counts: {
    totalRowCount: Math.max(0, range.lastRow - range.firstRow + 1),
    headerRows: startIndex,
    blankRows: blankRows.length,
    dataRows: rows.length - blankRows.length,
    duplicateRows: duplicates.length,
    uniqueServiceTypes: unique.length,
    invalidRows: invalid.length,
    rowsWithExtraColumns: extraColumnRows.length,
  },
  categoryCounts,
  duplicates,
  invalid,
  unmapped,
  rows,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const md = [
  "# Service type seed preview (read only)",
  "",
  `- source: \`${report.source}\``,
  `- sheet: \`${sheetName}\` (book sheets: ${workbook.SheetNames.join(", ")})`,
  `- used range: \`${report.usedRange ?? "empty"}\``,
  `- header: ${headerLooksLikeName ? `\`${cellText(headerRow[0])}\`` : "none detected"}`,
  "",
  "## Counts",
  "",
  "| metric | value |",
  "| --- | --- |",
  ...Object.entries(report.counts).map(([key, value]) => `| ${key} | ${value} |`),
  "",
  "## Categories",
  "",
  "| category | rows |",
  "| --- | --- |",
  ...Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `| ${key} | ${value} |`),
  "",
  `## Duplicates (${duplicates.length})`,
  "",
  ...(duplicates.length
    ? duplicates.map(
        (row) =>
          `- row ${row.sheetRow} "${row.name}" duplicates row ${row.duplicateOfRow} ("${row.duplicateOfName}", matched on ${row.matchedOn})`,
      )
    : ["- none"]),
  "",
  `## Invalid (${invalid.length})`,
  "",
  ...(invalid.length
    ? invalid.map((row) => `- row ${row.sheetRow} "${row.name}" -> ${row.reasons.join("; ")}`)
    : ["- none"]),
  "",
  `## Unmapped to a keyword rule — filed as \`other\` (${unmapped.length})`,
  "",
  ...(unmapped.length
    ? unmapped.map((row) => `- row ${row.sheetRow} "${row.name}" (${row.key})`)
    : ["- none"]),
  "",
  `## Blank rows (${blankRows.length})`,
  "",
  ...(blankRows.length ? blankRows.map((row) => `- row ${row.sheetRow}`) : ["- none"]),
  "",
  `## Rows carrying columns beyond the name (${extraColumnRows.length})`,
  "",
  ...(extraColumnRows.length
    ? extraColumnRows.map((row) => `- row ${row.sheetRow} "${row.labelEn ?? row.rawName ?? ""}"`)
    : ["- none"]),
  "",
  "Nothing was written to Firestore.",
  "",
].join("\n");
writeFileSync(mdPath, md, "utf8");

console.log(`source              : ${report.source}`);
console.log(`sheet               : ${sheetName}  (book sheets: ${workbook.SheetNames.join(", ")})`);
console.log(`used range          : ${report.usedRange}`);
console.log(`total rows          : ${report.counts.totalRowCount}`);
console.log(`header rows         : ${report.counts.headerRows}`);
console.log(`blank rows          : ${report.counts.blankRows}${blankRows.length ? ` (${blankRows.map((r) => r.sheetRow).join(", ")})` : ""}`);
console.log(`data rows           : ${report.counts.dataRows}`);
console.log(`normalised dups     : ${report.counts.duplicateRows}`);
for (const row of duplicates) {
  console.log(`  row ${row.sheetRow} "${row.name}" -> row ${row.duplicateOfRow} "${row.duplicateOfName}" (${row.matchedOn})`);
}
console.log(`unique types        : ${report.counts.uniqueServiceTypes}`);
console.log(`invalid             : ${report.counts.invalidRows}`);
for (const row of invalid) console.log(`  row ${row.sheetRow} "${row.name}" -> ${row.reasons.join("; ")}`);
console.log(`unmapped (other)    : ${unmapped.length}`);
for (const [category, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${category.padEnd(13)} ${count}`);
}
console.log(`rows w/ extra cols  : ${extraColumnRows.length}`);
console.log(`\nJSON : ${outPath}`);
console.log(`MD   : ${mdPath}`);
console.log("\nNothing was written to Firestore.");

