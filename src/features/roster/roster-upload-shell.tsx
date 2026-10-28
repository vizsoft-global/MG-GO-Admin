"use client";

import { Check, Download, Upload } from "lucide-react";
import { useMemo, useState, type ChangeEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import * as XLSX from "xlsx";
import { formatKuwaitDateTime } from "@/features/driver-tracking/shift-adherence-display";
import { downloadWorkbookXlsx } from "@/features/drivers/import/export-xlsx";
import { cn } from "@/lib/utils";
import { TableNameCell, useTablePrefs, type TableToolbarColumn } from "@/components/app/table-toolbar";
import { ListToolbar, rowMatches } from "@/features/roster/table-kit";
import { applyRosterSheet, previewRosterSheet } from "./roster-actions";
import { RosterNav } from "./roster-nav";
import { clock12, weekdayShort } from "./roster-range";
import { rosterError } from "./roster-result";
import { rosterSampleWorkbook } from "./roster-sheet";
import { rosterBtn, rosterBtnSoft, rosterCanvas, rosterCard, rosterH1, rosterMuted, rosterTd, rosterTh } from "./roster-ui";

type PreviewResult = Awaited<ReturnType<typeof previewRosterSheet>>;
type PreviewOk = Extract<PreviewResult, { overwritesApproved: number }>;
type RosterPreviewRow = PreviewOk["rows"][number];

function sheetFromFile(file: File): Promise<{ aoa: unknown[][]; sheetName: string }> {
  return file.arrayBuffer().then((buffer) => {
    const book = XLSX.read(buffer, { type: "array" });
    const sheetName = book.SheetNames[0] ?? "";
    const sheet = book.Sheets[sheetName];
    return {
      aoa: sheet ? (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as unknown[][]) : [],
      sheetName,
    };
  });
}

function dayMonth(date: string, locale: string, withYear = false): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  const tag = locale.startsWith("ar") ? "ar" : "en-GB";
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString(tag, {
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

function isPreview(value: PreviewResult): value is PreviewOk {
  return (
    typeof value === "object" &&
    value !== null &&
    "overwritesApproved" in value &&
    Array.isArray(value.rows) &&
    typeof value.ready === "number" &&
    typeof value.failed === "number" &&
    typeof value.overwritesApproved === "number"
  );
}

function sessionCopy(row: RosterPreviewRow, overnightLabel: string, offLabel: string): string[] {
  if (row.off) return [offLabel];
  switch (row.shiftType) {
    case "split": {
      const lines = [
        `${clock12(row.session1Start)} – ${clock12(row.session1End)}`,
        `${clock12(row.session2Start)} – ${clock12(row.session2End)}`,
      ];
      if (row.session1EndDayOffset === 1 || row.session2EndDayOffset === 1) lines.push(overnightLabel);
      return lines;
    }
    case "single": {
      const line = `${clock12(row.session1Start)} – ${clock12(row.session1End)}`;
      return row.session1EndDayOffset === 1 ? [line, overnightLabel] : [line];
    }
    default: {
      const _never: never = row.shiftType;
      return _never;
    }
  }
}

export function RosterUploadShell() {
  const t = useTranslations("pages.roster");
  const issueColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "row", label: "#", locked: true },
      { id: "key", label: t("nameOrId") },
      { id: "rider", label: t("rider"), locked: true },
      { id: "issue", label: t("issue") },
    ],
    [t],
  );
  const issuePrefs = useTablePrefs("roster.uploadIssues", issueColumns);
  const locale = useLocale();
  const [fileName, setFileName] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [uploadedAt, setUploadedAt] = useState("");
  const [aoa, setAoa] = useState<unknown[][] | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const sheet = preview && isPreview(preview) ? preview : null;
  const rows = sheet?.rows ?? [];
  const ready = sheet?.ready ?? 0;
  const failed = sheet?.failed ?? 0;
  const overwrites = sheet?.overwritesApproved ?? 0;
  const issues = rows.filter((row) => row.errors.length > 0);
  const readyRows = rows.filter((row) => row.errors.length === 0);
  const uniqueMatched = new Set(readyRows.map((row) => row.driverId).filter(Boolean)).size;
  const workCount = rows.filter((row) => !row.off).length;
  const offCount = rows.filter((row) => row.off).length;
  const split = rows.filter((row) => row.shiftType === "split").length;
  const overnight = rows.filter((row) => row.session1EndDayOffset === 1 || row.session2EndDayOffset === 1).length;
  const dates = [...new Set(rows.map((row) => row.date).filter(Boolean))].sort();
  const fromLabel = dates[0] ? dayMonth(dates[0], locale) : "";
  const toLabel = dates.length > 0 ? dayMonth(dates[dates.length - 1], locale, true) : "";
  const replaced = Boolean(note?.startsWith(t("written")));
  const step = replaced ? 2 : sheet ? 1 : 0;
  const firstReady = readyRows.find((row) => row.driverId);
  const previewDays = firstReady
    ? rows.filter((row) => row.driverId === firstReady.driverId).slice().sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const previewStore = previewDays.map((row) => row.storeName).find((name) => name.trim()) || firstReady?.storeName || "";
  const stepLabels = [t("stepChoose"), t("stepReview"), t("stepReplace")] as const;

  function clearSheet() {
    setAoa(null);
    setPreview(null);
    setFileName("");
    setSheetName("");
    setUploadedAt("");
    setNote(null);
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setNote(null);
    void sheetFromFile(file).then(async (next) => {
      setSheetName(next.sheetName);
      setUploadedAt(new Date().toISOString());
      setAoa(next.aoa);
      const result = await previewRosterSheet(next.aoa);
      setPreview(result);
      const code = rosterError(result);
      setNote(code ? t(`errors.${code}`) : null);
    });
  }

  return (
    <div className={rosterCanvas}>
      <RosterNav />
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-[#A8321D] text-white">
          <Upload className="size-4" fill="currentColor" strokeWidth={2.5} aria-hidden />
        </span>
        <div>
          <h1 className={rosterH1}>{t("navUpload")}</h1>
          <p className={rosterMuted}>{t("uploadLead")}</p>
        </div>
      </div>
      <div className={cn(rosterCard, "overflow-hidden")}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <button
            type="button"
            className={rosterBtnSoft}
            onClick={() => downloadWorkbookXlsx("roster-weekly-sample.xlsx", rosterSampleWorkbook())}
          >
            <Download className="size-4" aria-hidden />
            {t("template")}
          </button>
          <ol className="flex flex-wrap items-center gap-2">
            {stepLabels.map((label, index) => {
              const done = index < step;
              const current = index === step;
              return (
                <li key={label} className="flex items-center gap-1.5">
                  {index > 0 ? <span className="h-px w-3 bg-[#E2DCD8]" aria-hidden /> : null}
                  <span
                    className={cn(
                      "grid size-6 place-items-center rounded-full text-[11px] font-semibold",
                      done && "bg-[#146C43] text-white",
                      current && "bg-[#A8321D] text-white",
                      !done && !current && "bg-[#F3EFED] text-[#5E5754]",
                    )}
                    aria-current={current ? "step" : undefined}
                  >
                    {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : index + 1}
                  </span>
                  <span className={cn("text-sm", current ? "font-semibold text-[#1D1B1A]" : "text-[#5E5754]")}>{label}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <input id="roster-sheet-file" type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={onPick} />
        {fileName ? (
          <div className="px-4 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-[#A3D9B1] bg-[#EEF8F1] px-3 py-2.5">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 rounded bg-[#146C43] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  {t("fileXlsx")}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#1D1B1A]">{fileName}</p>
                  <p className="text-[11px] text-[#3D3734]">
                    {[
                      sheetName || null,
                      dates.length > 0 ? t("sheetDates", { from: fromLabel, to: toLabel }) : null,
                      uploadedAt ? t("uploadedAt", { time: formatKuwaitDateTime(uploadedAt) }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>
              <label htmlFor="roster-sheet-file" className={cn(rosterBtnSoft, "cursor-pointer")}>
                {t("chooseDifferent")}
              </label>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            <label htmlFor="roster-sheet-file" className={cn(rosterBtn, "cursor-pointer")}>
              {t("chooseFile")}
            </label>
            <p className="text-sm text-[#5E5754]">{t("templateHint")}</p>
          </div>
        )}
        {note && !replaced ? <p className="px-4 pt-2 text-xs text-destructive">{note}</p> : null}
        {replaced ? <p className="px-4 pt-2 text-sm font-semibold text-[#146C43]">{note}</p> : null}
        {rows.length > 0 ? (
          <div className="space-y-3 px-4 py-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {(
                [
                  [t("rowsRead"), rows.length, t("rowsReadHint", { shifts: workCount, off: offCount }), false],
                  [t("ridersMatched"), uniqueMatched, t("matchedHint"), false],
                  [t("splitShifts"), split, t("splitHint"), false],
                  [t("endsNextDay"), overnight, t("overnightHint"), false],
                  [t("needAttention"), failed, t("attentionHint"), failed > 0],
                ] as const
              ).map(([label, value, hint, rose]) => (
                <div
                  key={label}
                  className={cn(rosterCard, "p-3", rose && "border-[#F1C0C0] bg-[#FDECEC]")}
                >
                  <p className="text-[11px] text-[#5E5754]">{label}</p>
                  <p className={cn("text-xl font-semibold", rose && "text-[#B42318]")}>{value.toLocaleString(locale)}</p>
                  <p className="text-[10px] text-[#5E5754]">{hint}</p>
                </div>
              ))}
            </div>
            <div className={cn("grid items-stretch gap-2", previewDays.length > 0 && "lg:grid-cols-[minmax(0,1fr)_280px]")}>
              <div className="flex min-w-0 flex-col gap-2">
                <section className={cn(rosterCard, "h-full p-4 text-sm")}>
                  <h2 className="font-semibold">{t("whatUploadChanges")}</h2>
                  <ul className="mt-2 list-disc space-y-1 ps-4 text-[#3D3734]">
                    {dates.length > 0 ? <li>{t("replaceWindow", { from: fromLabel, to: toLabel })}</li> : null}
                    <li>{t("ridersMatchedDetail", { count: uniqueMatched })}</li>
                    <li>{t("daysNotInFile")}</li>
                    <li>{t("ridersZoneMove")}</li>
                    {overwrites > 0 ? <li className="font-semibold text-[#B45309]">{t("overwriteWarning")}</li> : null}
                  </ul>
                </section>
                {issues.length > 0 ? (
                  <section className={cn(rosterCard, "overflow-hidden")}>
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                      <h2 className="text-sm font-semibold">
                        {t("needAttention")}{" "}
                        <span className="font-semibold text-[#B42318]">{t("issuesCount", { count: issues.length })}</span>
                      </h2>
                      <button
                        type="button"
                        className={rosterBtnSoft}
                        onClick={() =>
                          downloadWorkbookXlsx("roster-issues.xlsx", [
                            {
                              name: "Issues",
                              aoa: [
                                ["#", t("nameOrId"), t("rider"), t("issue")],
                                ...issues.map((row) => [
                                  row.rows[0] ?? "",
                                  row.driverKey,
                                  row.driverName || row.driverLabel,
                                  row.errors.map((code) => t(`errors.${code}`)).join(", "),
                                ]),
                              ],
                            },
                          ])
                        }
                      >
                        <Download className="size-4" aria-hidden />
                        {t("downloadIssues")}
                      </button>
                    </div>
                    <ListToolbar
                      prefs={issuePrefs}
                      entity={t("rider")}
                      columns={issueColumns}
                      rowKind="dynamic"
                      filteredCount={issues.filter((row) => rowMatches(issuePrefs.appliedQuery, [row.driverKey, row.driverName, row.driverLabel, row.errors.join(" ")])).length}
                      totalCount={issues.length}
                    />
                    <div className="max-h-48 overflow-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-y border-[#E2DCD8]">
                            {["#", t("nameOrId"), t("rider"), t("issue")].map((label) => (
                              <th key={label} className={rosterTh}>
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {issues.filter((row) => rowMatches(issuePrefs.appliedQuery, [row.driverKey, row.driverName, row.driverLabel, row.errors.join(" ")])).map((row) => (
                            <tr key={`${row.driverKey}-${row.date}-${row.rows[0] ?? ""}`} className="border-b border-[#E2DCD8]">
                              <td className={rosterTd}>{row.rows[0] ?? "—"}</td>
                              <td className={rosterTd}>{row.driverKey}</td>
                              <td className={rosterTd}><TableNameCell name={row.driverName || row.driverLabel} /></td>
                              <td className={rosterTd}>{row.errors.map((code) => t(`errors.${code}`)).join(", ")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}
              </div>
              {previewDays.length > 0 && firstReady ? (
                <aside className={cn(rosterCard, "h-full p-4")}>
                  <p className="text-[11px] text-[#5E5754]">{t("previewSchedule")}</p>
                  <p className="mt-1 text-sm font-semibold text-[#1D1B1A]">
                    {firstReady.driverLabel || firstReady.driverName} · #{firstReady.driverKey}
                  </p>
                  {previewStore ? <p className="text-[11px] text-[#5E5754]">{previewStore}</p> : null}
                  <ul className="mt-2 space-y-2">
                    {previewDays.map((row) => (
                      <li key={row.date} className="flex gap-2 border-t border-[#E2DCD8] pt-2 first:border-t-0 first:pt-0">
                        <div className="w-14 shrink-0">
                          <p className="text-sm font-semibold">{weekdayShort(row.date, locale)}</p>
                          <p className="text-[11px] text-[#5E5754]">{dayMonth(row.date, locale)}</p>
                        </div>
                        <div className="min-w-0 text-sm">
                          {sessionCopy(row, t("endsNextDay"), t("offNoAlerts")).map((line, index) => (
                            <p
                              key={`${row.date}-${index}`}
                              className={line === t("offNoAlerts") || line === t("endsNextDay") ? "text-[11px] text-[#5E5754]" : undefined}
                            >
                              {line}
                            </p>
                          ))}
                          {row.notes?.trim() ? <p className="text-[11px] text-[#5E5754]">{row.notes}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </aside>
              ) : null}
            </div>
          </div>
        ) : null}
        {sheet ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-[#E2DCD8] px-4 py-3">
            <button
              type="button"
              className={rosterBtn}
              disabled={!aoa || ready === 0}
              onClick={() => {
                if (!aoa) return;
                void applyRosterSheet(aoa).then((result) => {
                  if ("written" in result && typeof result.written === "number") setNote(`${t("written")} ${result.written}`);
                  else setNote(t(`errors.${rosterError(result) ?? "not_configured"}`));
                });
              }}
            >
              {t("replaceRange", {
                from: fromLabel,
                to: dates.length > 0 ? dayMonth(dates[dates.length - 1], locale) : "",
                ready: ready.toLocaleString(locale),
              })}
            </button>
            <button type="button" className={rosterBtnSoft} onClick={clearSheet}>
              {t("cancel")}
            </button>
            {failed > 0 ? <p className={rosterMuted}>{t("issuesSkipped", { count: failed })}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
