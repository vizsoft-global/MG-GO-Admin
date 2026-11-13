"use client";

import { useMemo, useRef, useState, type ChangeEvent, type JSX } from "react";
import { FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { textFromImportFile } from "../../hr-payroll-export";
import type { HrImportField } from "../../hr-payroll-types";

const IMPORT_FIELDS = [
  "pendingSalary",
  "trafficViolation",
  "loanDeduction",
  "totalAllowances",
  "totalDeductions",
] as const satisfies readonly HrImportField[];

function importFieldLabel(
  field: HrImportField,
  labels: {
    pendingSalary: string;
    trafficViolation: string;
    loanDeduction: string;
    totalAllowances: string;
    totalDeductions: string;
  },
): string {
  switch (field) {
    case "pendingSalary":
      return labels.pendingSalary;
    case "trafficViolation":
      return labels.trafficViolation;
    case "loanDeduction":
      return labels.loanDeduction;
    case "totalAllowances":
      return labels.totalAllowances;
    case "totalDeductions":
      return labels.totalDeductions;
    default: {
      const unreachable: never = field;
      return unreachable;
    }
  }
}

function asImportField(value: string): HrImportField | null {
  switch (value) {
    case "pendingSalary":
    case "trafficViolation":
    case "loanDeduction":
    case "totalAllowances":
    case "totalDeductions":
      return value;
    default:
      return null;
  }
}

/** One `ID, amount` line: what the importer will try to match. */
type ImportPreviewRow = { id: string; amount: string; ok: boolean };

/**
 * What the paste/file will do, before it is applied.
 *
 * The tab re-parses against the live roster (that is what decides whether an id
 * exists), so this preview answers the two questions the operator has in front of
 * them: how many rows came through, and which lines are not `id, amount`.
 */
function previewRows(text: string): ImportPreviewRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, index) => {
    const [id = "", amount = ""] = line.split(/[,\t;]/).map((part) => part.trim());
    const numeric = amount !== "" && Number.isFinite(Number(amount.replace(/,/g, "")));
    // A header row ("MG ID, Amount") is not a problem, it is just not a row.
    const header = index === 0 && !numeric && /id|amount|salary|value/i.test(amount);
    return { id, amount, ok: id !== "" && numeric && !header };
  });
}

async function applyImportFile(
  event: ChangeEvent<HTMLInputElement>,
  setText: (value: string) => void,
  setFileName: (value: string) => void,
): Promise<void> {
  const file = event.target.files?.[0];
  if (!file) return;
  setFileName(file.name);
  setText(await textFromImportFile(file));
}

export function HrImportDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: {
    title: string;
    field: string;
    pendingSalary: string;
    trafficViolation: string;
    loanDeduction: string;
    totalAllowances: string;
    totalDeductions: string;
    paste: string;
    file: string;
    cancel: string;
    done: string;
    hint: string;
    preview: string;
    previewReady: string;
    previewProblems: string;
    previewEmpty: string;
    idColumn: string;
    amountColumn: string;
    clearFile: string;
  };
  onApply: (field: HrImportField, text: string) => void;
}): JSX.Element {
  const [field, setField] = useState<HrImportField>("pendingSalary");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => previewRows(text), [text]);
  const ready = preview.filter((row) => row.ok).length;
  const problems = preview.length - ready;

  function reset(): void {
    setText("");
    setFileName("");
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[min(720px,96vw)] gap-0 p-0" showCloseButton>
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4 pt-10">
            <div className="space-y-1">
              <label htmlFor="hrpay-import-field" className="block text-xs font-medium text-foreground">
                {props.labels.field}
              </label>
              <select
                id="hrpay-import-field"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={field}
                onChange={(event) => {
                  const next = asImportField(event.target.value);
                  if (next) setField(next);
                }}
              >
                {IMPORT_FIELDS.map((item) => (
                  <option key={item} value={item}>
                    {importFieldLabel(item, props.labels)}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">{props.labels.hint}</p>
            </div>

            <div className="space-y-1">
              <label htmlFor="hrpay-import-text" className="block text-xs font-medium text-foreground">
                {props.labels.paste}
              </label>
              <Textarea
                id="hrpay-import-text"
                rows={5}
                value={text}
                placeholder={"10043, 12.5\n10044, 8"}
                className="min-h-[120px] w-full resize-y font-mono text-xs"
                onChange={(event) => setText(event.target.value)}
              />
            </div>

            <div className="space-y-1">
              <p className="block text-xs font-medium text-foreground">{props.labels.file}</p>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {fileName || props.labels.file}
                </span>
                {fileName ? (
                  <Button type="button" variant="ghost" size="sm" className="h-7" onClick={reset}>
                    <X className="size-3.5" />
                    {props.labels.clearFile}
                  </Button>
                ) : null}
                <Input
                  ref={fileInput}
                  type="file"
                  accept=".csv,.txt,.xlsx"
                  aria-label={props.labels.file}
                  className="h-9 w-full text-xs sm:w-[190px] sm:shrink-0"
                  onChange={(event) => {
                    void applyImportFile(event, setText, setFileName);
                  }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-medium text-foreground">{props.labels.preview}</p>
                <p className="text-[10px] tabular-nums text-muted-foreground">
                  {props.labels.previewReady.replace("#count#", String(ready))}
                  {problems > 0
                    ? ` · ${props.labels.previewProblems.replace("#count#", String(problems))}`
                    : ""}
                </p>
              </div>
              <div className="max-h-56 overflow-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr>
                      <th className="px-2 py-1 text-start font-bold">{props.labels.idColumn}</th>
                      <th className="px-2 py-1 text-start font-bold">{props.labels.amountColumn}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-2 py-3 text-center text-muted-foreground">
                          {props.labels.previewEmpty}
                        </td>
                      </tr>
                    ) : (
                      preview.slice(0, 200).map((row, index) => (
                        <tr
                          key={`${row.id}-${index}`}
                          className={row.ok ? undefined : "bg-destructive/10 text-destructive"}
                        >
                          <td className="px-2 py-1 font-mono">{row.id || "—"}</td>
                          <td className="px-2 py-1 font-mono">{row.amount || "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="p-3 pt-0">
            <AppModalFooter
              title={props.labels.title}
              subtitle={props.labels.hint}
              meta={
                <span className="tabular-nums">
                  {props.labels.previewReady.replace("#count#", String(ready))}
                </span>
              }
            >
              <Button type="button" variant="outline" className="h-9" onClick={() => props.onOpenChange(false)}>
                {props.labels.cancel}
              </Button>
              <Button
                type="button"
                className="h-9"
                disabled={ready === 0}
                onClick={() => {
                  props.onApply(field, text);
                  props.onOpenChange(false);
                }}
              >
                {props.labels.done}
              </Button>
            </AppModalFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

