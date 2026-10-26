"use client";

import { Upload } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import * as XLSX from "xlsx";
import { downloadWorkbookXlsx } from "@/features/drivers/import/export-xlsx";
import { cn } from "@/lib/utils";
import { applyRosterSheet, previewRosterSheet } from "./roster-actions";
import { RosterNav } from "./roster-nav";
import { rosterError } from "./roster-result";
import { rosterBtn, rosterBtnSoft, rosterCanvas, rosterCard, rosterH1, rosterMuted, rosterTd, rosterTh } from "./roster-ui";

function sheetFromFile(file: File): Promise<unknown[][]> {
  return file.arrayBuffer().then((buffer) => {
    const book = XLSX.read(buffer, { type: "array" });
    const sheet = book.Sheets[book.SheetNames[0] ?? ""];
    return sheet ? (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as unknown[][]) : [];
  });
}

export function RosterUploadShell() {
  const t = useTranslations("pages.roster");
  const [fileName, setFileName] = useState("");
  const [aoa, setAoa] = useState<unknown[][] | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewRosterSheet>> | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const sheet =
    preview &&
    "overwritesApproved" in preview &&
    Array.isArray(preview.rows) &&
    typeof preview.ready === "number" &&
    typeof preview.failed === "number" &&
    typeof preview.overwritesApproved === "number"
      ? preview
      : null;
  const rows = sheet?.rows ?? [];
  const ready = sheet?.ready ?? 0;
  const failed = sheet?.failed ?? 0;
  const overwrites = sheet?.overwritesApproved ?? 0;
  const issues = rows.filter((row) => row.errors.length > 0);
  const split = rows.filter((row) => row.shiftType === "split").length;
  const overnight = rows.filter((row) => row.session1EndDayOffset === 1 || row.session2EndDayOffset === 1).length;
  const dates = rows.map((row) => row.date).filter(Boolean).sort();
  const replaced = Boolean(note?.startsWith(t("written")));
  const step = replaced ? 2 : sheet ? 1 : 0;

  function clearSheet() {
    setAoa(null);
    setPreview(null);
    setFileName("");
    setNote(null);
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
      <div className="flex flex-wrap gap-1">
        {[t("stepChoose"), t("stepReview"), t("stepReplace")].map((label, index) => (
          <span key={label} className={cn("inline-flex h-9 items-center rounded-full px-3 text-sm font-semibold", step === index ? "bg-[#1D1B1A] text-white" : "bg-white text-[#3D3734]")}>
            {index + 1}. {label}
          </span>
        ))}
      </div>
      <div className={cn(rosterCard, "flex flex-wrap items-center gap-2 p-4")}>
        <label className={cn(rosterBtn, "cursor-pointer")}>
          {sheet ? t("chooseDifferent") : t("chooseFile")}
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setNote(null);
              void sheetFromFile(file).then(async (next) => {
                setAoa(next);
                const result = await previewRosterSheet(next);
                setPreview(result);
                const code = rosterError(result);
                setNote(code ? t(`errors.${code}`) : null);
              });
            }}
          />
        </label>
        {fileName ? <p className="text-sm text-[#5E5754]">{fileName}{dates.length > 0 ? ` · ${dates[0]} – ${dates[dates.length - 1]}` : ""}</p> : null}
      </div>
      {note && !replaced ? <p className="text-xs text-destructive">{note}</p> : null}
      {replaced ? <p className="text-sm font-semibold text-[#146C43]">{note}</p> : null}
      {rows.length > 0 ? (
        <>
          <div className="grid gap-2 sm:grid-cols-5">
            {[
              [t("rowsRead"), rows.length],
              [t("ridersMatched"), ready],
              [t("splitShifts"), split],
              [t("endsNextDay"), overnight],
              [t("failed"), failed],
            ].map(([label, value]) => (
              <div key={String(label)} className={cn(rosterCard, "p-3")}>
                <p className="text-xs text-[#5E5754]">{label}</p>
                <p className="text-xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <section className={cn(rosterCard, "p-4 text-sm")}>
            <h2 className="font-semibold">{t("whatUploadChanges")}</h2>
            <p className="mt-1 text-[#5E5754]">{t("ready")} {ready}. {t("failed")} {failed}.</p>
            {overwrites > 0 ? <p className="mt-1 font-semibold text-[#B45309]">{t("overwriteWarning")} · {overwrites}</p> : null}
          </section>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={rosterBtnSoft}
              disabled={issues.length === 0}
              onClick={() =>
                downloadWorkbookXlsx("roster-issues.xlsx", [
                  {
                    name: "Issues",
                    aoa: [[t("rider"), t("date"), t("issue")], ...issues.map((row) => [row.driverLabel, row.date, row.errors.join(", ")])],
                  },
                ])
              }
            >
              {t("downloadIssues")}
            </button>
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
              {t("stepReplace")}
            </button>
            <button type="button" className={rosterBtnSoft} onClick={clearSheet}>{t("cancel")}</button>
          </div>
          {issues.length > 0 ? (
            <div className={cn(rosterCard, "overflow-x-auto")}>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#E2DCD8]">
                    {[t("rider"), t("date"), t("restaurant"), t("issue")].map((label) => (
                      <th key={label} className={rosterTh}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {issues.slice(0, 80).map((row) => (
                    <tr key={`${row.driverKey}-${row.date}`} className="border-b border-[#E2DCD8]">
                      <td className={rosterTd}>{row.driverLabel}</td>
                      <td className={rosterTd}>{row.date}</td>
                      <td className={rosterTd}>{row.storeName || "—"}</td>
                      <td className={rosterTd}>{row.errors.map((code) => t(`errors.${code}`)).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
