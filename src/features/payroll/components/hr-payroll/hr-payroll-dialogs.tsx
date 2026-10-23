"use client";

import { useState, type ChangeEvent, type JSX } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { HR_GROUP_ORDER } from "../../hr-payroll-columns";
import { textFromImportFile } from "../../hr-payroll-export";
import type { HrImportField, HrPayrollGroup } from "../../hr-payroll-types";

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

function groupLabel(
  group: HrPayrollGroup,
  labels: {
    emp: string;
    ops: string;
    in: string;
    calc: string;
    imp: string;
    pay: string;
  },
): string {
  switch (group) {
    case "emp":
      return labels.emp;
    case "ops":
      return labels.ops;
    case "in":
      return labels.in;
    case "calc":
      return labels.calc;
    case "imp":
      return labels.imp;
    case "pay":
      return labels.pay;
    default: {
      const unreachable: never = group;
      return unreachable;
    }
  }
}

async function applyImportFile(
  event: ChangeEvent<HTMLInputElement>,
  setText: (value: string) => void,
): Promise<void> {
  const file = event.target.files?.[0];
  if (!file) return;
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
  };
  onApply: (field: HrImportField, text: string) => void;
}): JSX.Element {
  const [field, setField] = useState<HrImportField>("pendingSalary");
  const [text, setText] = useState("");

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="hrpay-dialog" showCloseButton={false}>
        <DialogTitle>{props.labels.title}</DialogTitle>
        <label>
          {props.labels.field}
          <select
            className="hrpay-select"
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
        </label>
        <textarea
          placeholder={props.labels.paste}
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <label>
          {props.labels.file}
          <input
            type="file"
            accept=".csv,.txt,.xlsx"
            onChange={(event) => {
              void applyImportFile(event, setText);
            }}
          />
        </label>
        <p className="hrpay-note">{props.labels.hint}</p>
        <div className="hrpay-actions">
          <button
            type="button"
            className="hrpay-btn"
            onClick={() => props.onOpenChange(false)}
          >
            {props.labels.cancel}
          </button>
          <button
            type="button"
            className="hrpay-btn hrpay-btn-primary"
            disabled={text.trim() === ""}
            onClick={() => {
              props.onApply(field, text);
              props.onOpenChange(false);
            }}
          >
            {props.labels.done}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HrColumnsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shown: ReadonlySet<HrPayrollGroup>;
  onToggle: (group: HrPayrollGroup) => void;
  labels: {
    title: string;
    done: string;
    emp: string;
    ops: string;
    in: string;
    calc: string;
    imp: string;
    pay: string;
  };
}): JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="hrpay-dialog" showCloseButton={false}>
        <DialogTitle>{props.labels.title}</DialogTitle>
        {HR_GROUP_ORDER.map((group) => (
          <label key={group}>
            <input
              type="checkbox"
              checked={props.shown.has(group)}
              onChange={() => props.onToggle(group)}
            />
            {groupLabel(group, props.labels)}
          </label>
        ))}
        <button
          type="button"
          className="hrpay-btn hrpay-btn-primary"
          onClick={() => props.onOpenChange(false)}
        >
          {props.labels.done}
        </button>
      </DialogContent>
    </Dialog>
  );
}
