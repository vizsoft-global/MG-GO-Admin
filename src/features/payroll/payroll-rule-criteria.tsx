"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  RULE_NUMERIC_OPS,
  type PayrollRuleCondition,
  type RuleField,
  type RuleOp,
} from "./payroll-rules-engine";

const PICKER_FIELDS = ["orders", "dpd", "riders"] as const satisfies readonly RuleField[];
const CRITERIA_FIELDS = new Set<RuleField>(["orders", "hours", "dpd", "riders"]);

export function criteriaOf(conditions: readonly PayrollRuleCondition[]): PayrollRuleCondition[] {
  return conditions.filter((condition) => CRITERIA_FIELDS.has(condition.field));
}

export function PayrollRuleCriteria({
  conditions,
  disabled,
  onChange,
}: {
  conditions: readonly PayrollRuleCondition[];
  disabled?: boolean;
  onChange: (next: PayrollRuleCondition[]) => void;
}) {
  const t = useTranslations("pages.payroll.settings");
  const [open, setOpen] = useState(false);
  const criteria = criteriaOf(conditions);

  function update(index: number, patch: Partial<PayrollRuleCondition>) {
    onChange(criteria.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)));
  }

  function add(field: (typeof PICKER_FIELDS)[number]) {
    onChange([...criteria, { field, op: "gte", value: 0 }]);
    setOpen(false);
  }

  return (
    <div className="flex max-w-[28rem] flex-wrap items-center gap-1.5">
      {criteria.map((condition, index) => (
        <span key={`${condition.field}-${index}`} className="contents">
          {index > 0 ? <span className="text-[10px] text-muted-foreground">{t("rules.and")}</span> : null}
          <span className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-muted/30 pe-1">
            <span className="ps-2 text-xs font-medium">{t(`field.${condition.field}`)}</span>
            <Select value={condition.op} onValueChange={(op) => update(index, { op: op as RuleOp })}>
              <SelectTrigger className="h-9 w-[7.25rem] border-0 bg-transparent px-1 shadow-none" disabled={disabled}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RULE_NUMERIC_OPS.map((op) => (
                  <SelectItem key={op} value={op}>
                    {t(`op.${op}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="h-9 w-14 border-0 bg-transparent px-1 shadow-none"
              inputMode="decimal"
              disabled={disabled}
              value={typeof condition.value === "number" ? String(condition.value) : ""}
              onChange={(event) => {
                const raw = event.target.value;
                if (raw === "" || raw === "-") return;
                const value = Number(raw);
                if (Number.isFinite(value)) update(index, { value });
              }}
            />
            {disabled ? null : (
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                aria-label={t("rules.removeCriterion")}
                onClick={() => onChange(criteria.filter((_, i) => i !== index))}
              >
                <X className="size-3.5" />
              </button>
            )}
          </span>
        </span>
      ))}
      {disabled ? null : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-muted/40"
          >
            <Plus className="size-3.5" />
            {t("rules.addCriteria")}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2">
            <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              {t("rules.chooseCriterion")}
            </p>
            {PICKER_FIELDS.map((field) => (
              <Button
                key={field}
                type="button"
                variant="ghost"
                className="h-9 w-full justify-between px-2"
                onClick={() => add(field)}
              >
                {t(`field.${field}`)}
                <Plus className="size-3.5" />
              </Button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
