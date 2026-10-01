"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Check,
  FlaskConical,
  History,
  Loader2,
  MapPin,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatPayrollPct, type PayrollMonthMeta } from "./payroll-formulas";
import {
  describeRule,
  evalDay,
  fallbackClientConfig,
  firstMatchingRule,
  hoursForStatus,
  RULE_FIELDS,
  RULE_KIND_TO_STATUS,
  RULE_NUMERIC_OPS,
  RULE_RESULT_KINDS,
  RULE_SET_OPS,
  zoneCategoryFor,
  type PayrollClientConfig,
  type PayrollRule,
  type PayrollRuleCondition,
  type RuleField,
  type RuleOp,
  type RuleResultKind,
  type ZoneCategory,
} from "./payroll-rules-engine";
import {
  useAddPayrollClient,
  useOpenPayrollRuleMonth,
  usePayrollRuleConfig,
  useRecomputePayrollZoneMetrics,
  useResetPayrollClientRules,
  useSavePayrollClient,
  useSavePayrollClientRules,
  useSavePayrollZoneOverride,
} from "./use-payroll";
import type { PayrollZoneMetricRow } from "./payroll-types";

type RuleDraft = {
  /** A stable key for React, so reordering does not remount every row. */
  uid: string;
  label: string;
  conditions: PayrollRuleCondition[];
  result: { kind: RuleResultKind; hours: number | null };
};

let uidSeed = 0;
function nextUid(): string {
  uidSeed += 1;
  return `rule-${uidSeed}`;
}

function draftFromRule(rule: PayrollRule): RuleDraft {
  return {
    uid: nextUid(),
    label: rule.label,
    conditions: rule.conditions.map((c) => ({ ...c })),
    result: { kind: rule.result.kind, hours: rule.result.hours ?? null },
  };
}

function blankCondition(): PayrollRuleCondition {
  return { field: "orders", op: "lt", value: 7 };
}

/**
 * The Settings tab — SOP §5.5 and §8.
 *
 * Every rule write is a whole-list save (`admin_save_payroll_client_rules`),
 * diffed into the audit log on the server, so the change log can always answer
 * "who changed this rule and when". Nothing here writes until Save: an operator
 * building a six-condition rule list must be able to abandon it by navigating
 * away, which is also why the drafts are local state.
 */
export function PayrollSettingsTab({
  month,
  zoneMetrics,
  canManage,
}: {
  month: PayrollMonthMeta;
  zoneMetrics: readonly PayrollZoneMetricRow[];
  canManage: boolean;
}) {
  const t = useTranslations("pages.payroll.settings");
  // The day-status and zone-band vocabularies already exist for the grid and the
  // legend; a second copy here is how "Reduced day · 3 h" starts reading
  // differently on the Settings tab than on the day cells beside it.
  const tDayStatus = useTranslations("pages.payroll.dayStatus");
  const tZoneCategory = useTranslations("pages.payroll.zoneCategory");
  const config = usePayrollRuleConfig(month.key);
  const openMonth = useOpenPayrollRuleMonth();
  const saveClient = useSavePayrollClient();
  const addClient = useAddPayrollClient();
  const saveRules = useSavePayrollClientRules();
  const resetRules = useResetPayrollClientRules();
  const recompute = useRecomputePayrollZoneMetrics();
  const saveOverride = useSavePayrollZoneOverride();

  const [clientKey, setClientKey] = useState<string | null>(null);
  const [clientDraft, setClientDraft] = useState<PayrollClientConfig | null>(null);
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCopy, setAddCopy] = useState("none");
  const [simZone, setSimZone] = useState<ZoneCategory>("good");
  const [simOrders, setSimOrders] = useState("6");
  const [simHours, setSimHours] = useState("12");

  const clients = useMemo(() => config.data?.clients ?? [], [config.data?.clients]);

  // First paint picks a client. A month whose rules are missing is opened once
  // (seed the SOP starting list, or copy the previous month) so the operator
  // never lands on an empty rule table for a client that is already configured.
  useEffect(() => {
    if (clientKey || !clients.length) return;
    setClientKey(clients[0].key);
  }, [clientKey, clients]);

  useEffect(() => {
    if (!canManage || !config.data || !clients.length) return;
    if (clients.some((c) => c.hasRulesForMonth)) return;
    openMonth.mutate({ monthKey: month.key });
    // Keyed on the month rather than on `openMonth`: the mutation object changes
    // identity every render and would re-fire this effect forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, config.data, clients, month.key]);

  const selected = useMemo(
    () => clients.find((c) => c.key === clientKey) ?? null,
    [clients, clientKey],
  );

  useEffect(() => {
    setClientDraft(selected ? { ...selected } : null);
  }, [selected]);

  useEffect(() => {
    const forClient = (config.data?.rules ?? []).filter((r) => r.clientKey === clientKey);
    setRules(forClient.map(draftFromRule));
  }, [config.data?.rules, clientKey]);

  /* ---- the simulator: SOP §5.5 "Try the rules" ---- */

  const simulator = useMemo(() => {
    const orders = Number(simOrders);
    const hours = Number(simHours);
    if (!Number.isFinite(orders) || !Number.isFinite(hours)) return null;
    const client = clientDraft;
    const base = client ?? fallbackClientConfig(clientKey ?? "unknown");
    const list: PayrollRule[] = rules.map((r, index) => ({
      clientKey: base.key,
      periodMonth: `${month.key}-01`,
      sortOrder: index + 1,
      label: r.label,
      conditions: r.conditions,
      result: r.result,
    }));
    if (!client) {
      const outcome = evalDay({
        date: `${month.key}-01`,
        today: `${month.key}-28`,
        client: null,
        rules: [],
        zoneName: null,
        zoneCategory: simZone,
        loggedHours: hours,
        orders,
        cover: null,
        coverApproved: false,
        hasCheckIn: hours > 0,
        adjustment: null,
      });
      return { via: "legacy" as const, label: "", status: outcome.status, hours: outcome.hours };
    }
    const rule = firstMatchingRule(list, {
      zoneName: null,
      zoneCategory: simZone,
      orders,
      hours,
    });
    if (rule) {
      const status = RULE_KIND_TO_STATUS[rule.result.kind];
      return {
        via: "rule" as const,
        label: describeRule(rule),
        status,
        hours: hoursForStatus(status, {
          client,
          loggedHours: hours,
          customHours: rule.result.hours ?? null,
        }),
      };
    }
    const status = RULE_KIND_TO_STATUS[client.defaultResult.kind];
    return {
      via: "default" as const,
      label: "",
      status,
      hours: hoursForStatus(status, {
        client,
        loggedHours: hours,
        customHours: client.defaultResult.hours ?? null,
      }),
    };
  }, [simOrders, simHours, simZone, clientDraft, clientKey, rules, month.key]);

  /* ---- writes ---- */

  function patchClient(patch: Partial<PayrollClientConfig>) {
    setClientDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function commitClient() {
    if (!clientDraft || !canManage) return;
    saveClient.mutate(
      {
        key: clientDraft.key,
        name: clientDraft.name,
        usesZone: clientDraft.usesZone,
        usesOrders: clientDraft.usesOrders,
        usesHours: clientDraft.usesHours,
        fullDayHours: clientDraft.fullDayHours,
        halfDayHours: clientDraft.halfDayHours,
        reducedHours: clientDraft.reducedHours,
        requiredHoursPerDay: clientDraft.requiredHoursPerDay,
        defaultOffDays: clientDraft.defaultOffDays,
        defaultResult: clientDraft.defaultResult.kind,
        goodThreshold: clientDraft.goodThreshold,
        averageThreshold: clientDraft.averageThreshold,
        sortOrder: clientDraft.sortOrder,
      },
      {
        onSuccess: (result) =>
          "error" in result
            ? toast.error(errorText(t, result.error))
            : toast.success(t("clientSaved")),
        onError: () => toast.error(t("errors.unknown")),
      },
    );
  }

  function commitRules() {
    if (!clientKey || !canManage) return;
    saveRules.mutate(
      {
        clientKey,
        monthKey: month.key,
        rules: rules.map((r, index) => ({
          label: r.label,
          conditions: { all: r.conditions },
          result: r.result,
          sortOrder: index + 1,
        })),
      },
      {
        onSuccess: (result) =>
          "error" in result
            ? toast.error(errorText(t, result.error))
            : toast.success(t("rulesSaved", { count: rules.length })),
        onError: () => toast.error(t("errors.unknown")),
      },
    );
  }

  function doReset() {
    if (!clientKey || !canManage) return;
    resetRules.mutate(
      { clientKey, monthKey: month.key },
      {
        onSuccess: (result) =>
          "error" in result
            ? toast.error(errorText(t, result.error))
            : toast.success(t("rulesReset")),
        onError: () => toast.error(t("errors.unknown")),
      },
    );
  }

  function doAddClient() {
    const name = addName.trim();
    if (!name) {
      toast.error(t("addClient.nameRequired"));
      return;
    }
    addClient.mutate(
      {
        name,
        usesZone: true,
        usesOrders: true,
        usesHours: false,
        copyFrom: addCopy === "none" ? null : addCopy,
        monthKey: month.key,
      },
      {
        onSuccess: (result) => {
          if ("error" in result) {
            toast.error(errorText(t, result.error));
            return;
          }
          toast.success(t("addClient.saved", { name }));
          setAddOpen(false);
          setAddName("");
          setAddCopy("none");
        },
        onError: () => toast.error(t("errors.unknown")),
      },
    );
  }

  function move(index: number, delta: number) {
    setRules((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-[12px] leading-5 shadow-sm">
        <b>{t("bannerTitle")}</b> {t("bannerBody", { month: month.label })}
      </div>

      {/* ---- client picker ---- */}
      <div className="flex flex-wrap items-center gap-1.5">
        {clients.map((client) => (
          <ToggleChip
            key={client.key}
            selected={clientKey === client.key}
            icon={Building2}
            onClick={() => setClientKey(client.key)}
          >
            {client.name}
            <span className="tabular-nums opacity-70"> · {client.riderCount}</span>
            {client.hasRulesForMonth ? null : (
              <span className="rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">
                {t("noRulesYet")}
              </span>
            )}
          </ToggleChip>
        ))}
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => setAddOpen((prev) => !prev)}
          >
            <Plus className="size-3.5" />
            {t("addClient.open")}
          </Button>
        ) : null}
      </div>

      {addOpen && canManage ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="space-y-1">
            <Label htmlFor="payroll-new-client" className="text-[11px]">
              {t("addClient.name")}
            </Label>
            <Input
              id="payroll-new-client"
              className="h-9 w-56"
              value={addName}
              placeholder={t("addClient.namePlaceholder")}
              onChange={(e) => setAddName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">{t("addClient.copyFrom")}</Label>
            <Select value={addCopy} onValueChange={(value) => setAddCopy(value ?? "none")}>
              <SelectTrigger className="h-9 w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("addClient.copyNone")}</SelectItem>
                {clients.map((client) => (
                  <SelectItem key={client.key} value={client.key}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" className="h-9" disabled={addClient.isPending} onClick={doAddClient}>
            {addClient.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {t("addClient.save")}
          </Button>
        </div>
      ) : null}

      {clientDraft ? (
        <>
          {/* ---- client criteria + hours (SOP §4 / §5.5) ---- */}
          <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold">{t("criteria.title")}</h3>
              {canManage ? (
                <Button
                  type="button"
                  className="h-9"
                  disabled={saveClient.isPending}
                  onClick={commitClient}
                >
                  {saveClient.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  {t("criteria.save")}
                </Button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <ToggleChip
                selected={clientDraft.usesZone}
                icon={MapPin}
                onClick={() => patchClient({ usesZone: !clientDraft.usesZone })}
              >
                {t("criteria.usesZone")}
              </ToggleChip>
              <ToggleChip
                selected={clientDraft.usesOrders}
                icon={Check}
                onClick={() => patchClient({ usesOrders: !clientDraft.usesOrders })}
              >
                {t("criteria.usesOrders")}
              </ToggleChip>
              <ToggleChip
                selected={clientDraft.usesHours}
                icon={History}
                onClick={() => patchClient({ usesHours: !clientDraft.usesHours })}
              >
                {t("criteria.usesHours")}
              </ToggleChip>
            </div>

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-7">
              <NumberField
                id="payroll-full-hours"
                label={t("criteria.fullDayHours")}
                value={clientDraft.fullDayHours}
                onCommit={(v) => patchClient({ fullDayHours: v })}
              />
              <NumberField
                id="payroll-half-hours"
                label={t("criteria.halfDayHours")}
                value={clientDraft.halfDayHours}
                onCommit={(v) => patchClient({ halfDayHours: v })}
              />
              <NumberField
                id="payroll-reduced-hours"
                label={t("criteria.reducedHours")}
                value={clientDraft.reducedHours}
                onCommit={(v) => patchClient({ reducedHours: v })}
              />
              <NumberField
                id="payroll-required-hours"
                label={t("criteria.requiredHoursPerDay")}
                value={clientDraft.requiredHoursPerDay}
                onCommit={(v) => patchClient({ requiredHoursPerDay: v })}
              />
              <NumberField
                id="payroll-default-off"
                label={t("criteria.defaultOffDays")}
                value={clientDraft.defaultOffDays}
                step="1"
                onCommit={(v) => patchClient({ defaultOffDays: Math.round(v) })}
              />
              <NumberField
                id="payroll-good-threshold"
                label={t("criteria.goodThreshold")}
                value={clientDraft.goodThreshold}
                onCommit={(v) => patchClient({ goodThreshold: v })}
              />
              <NumberField
                id="payroll-average-threshold"
                label={t("criteria.averageThreshold")}
                value={clientDraft.averageThreshold}
                onCommit={(v) => patchClient({ averageThreshold: v })}
              />
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">{t("criteria.defaultResult")}</Label>
                <Select
                  value={clientDraft.defaultResult.kind}
                  onValueChange={(kind) =>
                    patchClient({ defaultResult: { kind: kind as RuleResultKind, hours: null } })
                  }
                >
                  <SelectTrigger className="h-9 w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RULE_RESULT_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(`result.${kind}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[10px] leading-4 text-muted-foreground">{t("criteria.defaultHint")}</p>
            </div>
          </div>

          {/* ---- rule builder ---- */}
          <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[13px] font-semibold">{t("rules.title", { month: month.label })}</h3>
                <p className="text-[10px] text-muted-foreground">{t("rules.hint")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canManage ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9"
                      onClick={() =>
                        setRules((prev) => [
                          ...prev,
                          {
                            uid: nextUid(),
                            label: "",
                            conditions: [blankCondition()],
                            result: { kind: "12", hours: null },
                          },
                        ])
                      }
                    >
                      <Plus className="size-3.5" />
                      {t("rules.addRule")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9"
                      disabled={resetRules.isPending}
                      onClick={doReset}
                    >
                      <RotateCcw className="size-3.5" />
                      {t("rules.reset")}
                    </Button>
                    <Button type="button" className="h-9" disabled={saveRules.isPending} onClick={commitRules}>
                      {saveRules.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      {t("rules.save")}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-max min-w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("rules.order")}</th>
                    <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("rules.condition")}</th>
                    <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("rules.result")}</th>
                    <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("rules.hours")}</th>
                    <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("rules.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-xs text-muted-foreground">
                        {t("rules.empty")}
                      </td>
                    </tr>
                  ) : (
                    rules.map((rule, index) => (
                      <tr key={rule.uid} className="border-b border-border/60 align-top">
                        <td className="px-2 py-2 text-center font-semibold tabular-nums">
                          {index + 1}
                        </td>
                        <td className="space-y-1.5 px-2 py-2">
                          <Input
                            className="h-9 w-72"
                            value={rule.label}
                            placeholder={t("rules.labelPlaceholder")}
                            disabled={!canManage}
                            onChange={(e) =>
                              setRules((prev) =>
                                prev.map((r, i) =>
                                  i === index ? { ...r, label: e.target.value } : r,
                                ),
                              )
                            }
                          />
                          {rule.conditions.map((condition, cIndex) => (
                            <div key={cIndex} className="flex items-center gap-1.5">
                              <Select
                                value={condition.field}
                                onValueChange={(field) =>
                                  setCondition(setRules, index, cIndex, { field: field as RuleField })
                                }
                              >
                                <SelectTrigger className="h-9 w-36" disabled={!canManage}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {RULE_FIELDS.map((field) => (
                                    <SelectItem key={field} value={field}>
                                      {t(`field.${field}`)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select
                                value={condition.op}
                                onValueChange={(op) =>
                                  setCondition(setRules, index, cIndex, { op: op as RuleOp })
                                }
                              >
                                <SelectTrigger className="h-9 w-32" disabled={!canManage}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {[...RULE_NUMERIC_OPS, ...RULE_SET_OPS].map((op) => (
                                    <SelectItem key={op} value={op}>
                                      {t(`op.${op}`)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <ConditionValueInput
                                condition={condition}
                                disabled={!canManage}
                                onChange={(value) =>
                                  setCondition(setRules, index, cIndex, { value })
                                }
                              />
                              {canManage && rule.conditions.length > 1 ? (
                                <button
                                  type="button"
                                  aria-label={t("rules.removeCondition")}
                                  className="inline-flex size-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                                  onClick={() =>
                                    setRules((prev) =>
                                      prev.map((r, i) =>
                                        i === index
                                          ? {
                                              ...r,
                                              conditions: r.conditions.filter(
                                                (_, j) => j !== cIndex,
                                              ),
                                            }
                                          : r,
                                      ),
                                    )
                                  }
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              ) : null}
                            </div>
                          ))}
                          {canManage ? (
                            <button
                              type="button"
                              className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-primary hover:bg-primary/10"
                              onClick={() =>
                                setRules((prev) =>
                                  prev.map((r, i) =>
                                    i === index
                                      ? { ...r, conditions: [...r.conditions, blankCondition()] }
                                      : r,
                                  ),
                                )
                              }
                            >
                              <Plus className="size-3.5" />
                              {t("rules.addCondition")}
                            </button>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          <Select
                            value={rule.result.kind}
                            onValueChange={(kind) =>
                              setRules((prev) =>
                                prev.map((r, i) =>
                                  i === index
                                    ? { ...r, result: { ...r.result, kind: kind as RuleResultKind } }
                                    : r,
                                ),
                              )
                            }
                          >
                            <SelectTrigger className="h-9 w-40" disabled={!canManage}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {RULE_RESULT_KINDS.map((kind) => (
                                <SelectItem key={kind} value={kind}>
                                  {t(`result.${kind}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {rule.result.kind === "CUS" ? (
                            <Input
                              className="mt-1.5 h-9 w-24"
                              inputMode="decimal"
                              value={rule.result.hours ?? ""}
                              disabled={!canManage}
                              onChange={(e) =>
                                setRules((prev) =>
                                  prev.map((r, i) =>
                                    i === index
                                      ? {
                                          ...r,
                                          result: {
                                            ...r.result,
                                            hours: e.target.value === "" ? null : Number(e.target.value),
                                          },
                                        }
                                      : r,
                                  ),
                                )
                              }
                            />
                          ) : null}
                        </td>
                        <td className="px-2 py-2 tabular-nums">
                          {rule.result.kind === "ACT" || rule.result.kind === "ABS" ||
                          rule.result.kind === "ALH" || rule.result.kind === "ALO" ? (
                            <span className="text-muted-foreground/60">—</span>
                          ) : (
                            hoursForResult(rule.result.kind, rule.result.hours, clientDraft)
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {canManage ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-label={t("rules.moveUp")}
                                className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted/60 disabled:opacity-40"
                                disabled={index === 0}
                                onClick={() => move(index, -1)}
                              >
                                <ArrowUp className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label={t("rules.moveDown")}
                                className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted/60 disabled:opacity-40"
                                disabled={index === rules.length - 1}
                                onClick={() => move(index, 1)}
                              >
                                <ArrowDown className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label={t("rules.removeRule")}
                                className="inline-flex size-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                                onClick={() =>
                                  setRules((prev) => prev.filter((_, i) => i !== index))
                                }
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- try the rules ---- */}
          <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-1.5">
              <FlaskConical className="size-3.5 text-primary" />
              <h3 className="text-[13px] font-semibold">{t("simulator.title")}</h3>
            </div>
            <p className="text-[10px] leading-4 text-muted-foreground">{t("simulator.hint")}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">{t("simulator.zoneCategory")}</Label>
                <Select value={simZone} onValueChange={(v) => setSimZone(v as ZoneCategory)}>
                  <SelectTrigger className="h-9 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["good", "average", "low", "not_set"] as ZoneCategory[]).map((category) => (
                      <SelectItem key={category} value={category}>
                        {tZoneCategory(category)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="payroll-sim-orders" className="text-[11px]">
                  {t("simulator.orders")}
                </Label>
                <Input
                  id="payroll-sim-orders"
                  className="h-9 w-24"
                  inputMode="numeric"
                  value={simOrders}
                  onChange={(e) => setSimOrders(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="payroll-sim-hours" className="text-[11px]">
                  {t("simulator.hours")}
                </Label>
                <Input
                  id="payroll-sim-hours"
                  className="h-9 w-24"
                  inputMode="decimal"
                  value={simHours}
                  onChange={(e) => setSimHours(e.target.value)}
                />
              </div>
            </div>
            {simulator ? (
              <div className="rounded-lg border border-emerald-400/50 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
                <p className="font-semibold">
                  {simulator.via === "rule"
                    ? t("simulator.decidedByRule", { label: simulator.label })
                    : simulator.via === "default"
                      ? t("simulator.decidedByDefault")
                      : t("simulator.decidedByLegacy")}
                </p>
                <p className="text-[11px]">
                  {t("simulator.outcome", {
                    status: tDayStatus(simulator.status),
                    hours: simulator.hours,
                  })}
                </p>
                <p className="text-[10px] opacity-80">{t("simulator.nothingSaved")}</p>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {/* ---- zones & efficiency ---- */}
      <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-semibold">{t("zones.title")}</h3>
            <p className="text-[10px] text-muted-foreground">{t("zones.hint")}</p>
          </div>
          {canManage ? (
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={recompute.isPending}
              onClick={() =>
                recompute.mutate(
                  { monthKey: month.key },
                  {
                    onSuccess: (result) =>
                      "error" in result
                        ? toast.error(errorText(t, result.error))
                        : toast.success(t("zones.recomputed")),
                    onError: () => toast.error(t("errors.unknown")),
                  },
                )
              }
            >
              {recompute.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
              {t("zones.recompute")}
            </Button>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-max min-w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-border">
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.zone")}</th>
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.orders")}</th>
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.riderDays")}</th>
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.dpd")}</th>
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.targetDpd")}</th>
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.dpdUsed")}</th>
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.efficiency")}</th>
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.category")}</th>
              </tr>
            </thead>
            <tbody>
              {zoneMetrics.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    {t("zones.empty")}
                  </td>
                </tr>
              ) : (
                zoneMetrics.map((zone) => (
                  <tr key={zone.zoneId} className="border-b border-border/60">
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium">{zone.zoneName}</td>
                    <td className="px-2 py-1.5 tabular-nums">{zone.orders}</td>
                    <td className="px-2 py-1.5 tabular-nums">{zone.riderDays}</td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {zone.dpd == null ? "—" : zone.dpd.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {zone.targetDpd == null ? "—" : zone.targetDpd.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5">
                      <ZoneOverrideEditor
                        zone={zone}
                        disabled={!canManage}
                        busy={saveOverride.isPending}
                        onSave={(input) => {
                          saveOverride.mutate(
                            { zoneId: zone.zoneId, monthKey: month.key, ...input },
                            {
                              onSuccess: (result) =>
                                "error" in result
                                  ? toast.error(errorText(t, result.error))
                                  : toast.success(t("zones.saved")),
                              onError: () => toast.error(t("errors.unknown")),
                            },
                          );
                        }}
                        labels={{
                          auto: t("zones.auto"),
                          save: t("zones.save"),
                          placeholder: t("zones.usedPlaceholder"),
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {zone.efficiency == null ? "—" : formatPayrollPct(zone.efficiency)}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <ZoneCategoryPillSmall
                          category={zone.categoryOverride ?? zone.categoryAuto}
                          label={
                            zone.categoryOverride
                              ? t("zones.manual", {
                                  category: tZoneCategory(zone.categoryOverride),
                                })
                              : tZoneCategory(zone.categoryAuto)
                          }
                        />
                        {canManage && zone.categoryOverride ? (
                          <button
                            type="button"
                            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-semibold text-primary hover:bg-primary/10"
                            onClick={() =>
                              saveOverride.mutate({
                                zoneId: zone.zoneId,
                                monthKey: month.key,
                                dpdUsed: zone.dpdUsed,
                                targetDpdUsed: zone.targetDpdUsed,
                                categoryOverride: null,
                              })
                            }
                          >
                            <RotateCcw className="size-3" />
                            {t("zones.auto")}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- change log ---- */}
      <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-1.5">
          <History className="size-3.5 text-primary" />
          <h3 className="text-[13px] font-semibold">{t("audit.title")}</h3>
        </div>
        <p className="text-[10px] text-muted-foreground">{t("audit.hint")}</p>
        <div className="max-h-[min(320px,38dvh)] overflow-auto">
          <table className="w-max min-w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border">
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("audit.when")}</th>
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("audit.who")}</th>
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("audit.client")}</th>
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("audit.action")}</th>
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("audit.detail")}</th>
              </tr>
            </thead>
            <tbody>
              {(config.data?.audit ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    {t("audit.empty")}
                  </td>
                </tr>
              ) : (
                (config.data?.audit ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{row.createdAt}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.actorName}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.clientKey ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{auditActionLabel(t, row.action)}</td>
                    <td className="px-2 py-1.5 text-[11px] text-muted-foreground">
                      {summariseAudit(row.after)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function setCondition(
  setRules: React.Dispatch<React.SetStateAction<RuleDraft[]>>,
  ruleIndex: number,
  conditionIndex: number,
  patch: Partial<PayrollRuleCondition>,
) {
  setRules((prev) =>
    prev.map((rule, i) => {
      if (i !== ruleIndex) return rule;
      return {
        ...rule,
        conditions: rule.conditions.map((condition, j) => {
          if (j !== conditionIndex) return condition;
          const next = { ...condition, ...patch };
          // A set operator needs a list; a numeric one needs a number. Switching
          // between them must not leave the value in the other's shape, or the
          // save would write a condition the engine reads as "never matches".
          if (["in", "not_in"].includes(next.op)) {
            const list = Array.isArray(next.value)
              ? next.value
              : [String(next.value ?? "").trim()].filter(Boolean);
            return { ...next, value: list };
          }
          if (Array.isArray(next.value)) {
            const first = next.value[0] ?? "";
            return { ...next, value: next.field === "zone" || next.field === "zone_category" ? first : Number(first) || 0 };
          }
          return next;
        }),
      };
    }),
  );
}

function ConditionValueInput({
  condition,
  disabled,
  onChange,
}: {
  condition: PayrollRuleCondition;
  disabled?: boolean;
  onChange: (value: string | number | string[]) => void;
}) {
  const t = useTranslations("pages.payroll.settings");
  if (condition.field === "zone_category") {
    const list = Array.isArray(condition.value)
      ? condition.value
      : [String(condition.value)];
    return (
      <Input
        className="h-9 w-52"
        value={list.join(", ")}
        disabled={disabled}
        placeholder={t("rules.zonePlaceholder")}
        onChange={(e) =>
          onChange(e.target.value.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean))
        }
      />
    );
  }
  if (Array.isArray(condition.value)) {
    return (
      <Input
        className="h-9 w-52"
        value={condition.value.join(", ")}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.split(",").map((part) => part.trim()).filter(Boolean))}
      />
    );
  }
  return (
    <Input
      className="h-9 w-28"
      inputMode={condition.field === "zone" ? "text" : "decimal"}
      value={String(condition.value)}
      disabled={disabled}
      onChange={(e) =>
        onChange(condition.field === "zone" ? e.target.value : Number(e.target.value) || 0)
      }
    />
  );
}

function hoursForResult(
  kind: RuleResultKind,
  hours: number | null,
  client: PayrollClientConfig,
): string {
  switch (kind) {
    case "12":
      return `${client.fullDayHours} h`;
    case "3h":
      return `${client.reducedHours} h`;
    case "HALF":
      return `${client.halfDayHours} h`;
    case "CUS":
      return `${hours ?? 0} h`;
    default:
      return "—";
  }
}

function ZoneCategoryPillSmall({ category, label }: { category: ZoneCategory; label: string }) {
  const tone =
    category === "good"
      ? "bg-emerald-100 text-emerald-800"
      : category === "average"
        ? "bg-amber-100 text-amber-800"
        : category === "low"
          ? "bg-red-100 text-red-700"
          : "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", tone)}>
      {label}
    </span>
  );
}

function ZoneOverrideEditor({
  zone,
  disabled,
  busy,
  onSave,
  labels,
}: {
  zone: PayrollZoneMetricRow;
  disabled: boolean;
  busy: boolean;
  onSave: (input: {
    dpdUsed: number | null;
    targetDpdUsed: number | null;
    categoryOverride: "good" | "average" | "low" | null;
  }) => void;
  labels: { auto: string; save: string; placeholder: string };
}) {
  const [value, setValue] = useState(zone.dpdUsed == null ? "" : String(zone.dpdUsed));
  useEffect(() => {
    setValue(zone.dpdUsed == null ? "" : String(zone.dpdUsed));
  }, [zone.dpdUsed]);
  if (disabled) {
    return <span className="tabular-nums">{zone.dpdUsed == null ? "—" : zone.dpdUsed.toFixed(2)}</span>;
  }
  return (
    <div className="flex items-center gap-1">
      <Input
        className="h-9 w-24"
        inputMode="decimal"
        value={value}
        placeholder={labels.placeholder}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button"
        disabled={busy}
        className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-[10px] font-semibold hover:bg-muted/50 disabled:opacity-50"
        onClick={() =>
          onSave({
            dpdUsed: value.trim() === "" ? null : Number(value),
            targetDpdUsed: zone.targetDpdUsed,
            categoryOverride: categoryOverrideFor(
              value.trim() === "" ? zone.dpd : Number(value),
              zone.targetDpdUsed ?? zone.targetDpd,
              zone.goodThreshold,
              zone.averageThreshold,
            ),
          })
        }
      >
        {labels.save}
      </button>
      {zone.dpdUsed != null ? (
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[10px] font-semibold text-primary hover:bg-primary/10"
          onClick={() =>
            onSave({ dpdUsed: null, targetDpdUsed: null, categoryOverride: null })
          }
        >
          <RotateCcw className="size-3" />
          {labels.auto}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The category a manual DPD implies, so setting a value also files the band the
 * operator is clearly aiming at. `null` when the figures are not there to divide
 * — an override with no target is "used", not "judged".
 */
function categoryOverrideFor(
  dpd: number | null,
  target: number | null,
  goodThreshold: number,
  averageThreshold: number,
): "good" | "average" | "low" | null {
  if (dpd == null || !target) return null;
  return zoneCategoryFor((dpd / target) * 100, goodThreshold, averageThreshold) as
    | "good"
    | "average"
    | "low";
}

function NumberField({
  id,
  label,
  value,
  step = "0.5",
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  step?: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px]">
        {label}
      </Label>
      <Input
        id={id}
        className="h-9"
        inputMode="decimal"
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const parsed = Number(draft);
          if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed);
          else setDraft(String(value));
        }}
      />
    </div>
  );
}

/**
 * A server error code as reader-facing copy. The actions return either one of
 * a small set of codes or a raw Postgres message, and passing the raw message
 * to `t()` would render a missing-key path at the operator — so anything not in
 * the list falls back to the generic line rather than leaking SQL.
 */
const KNOWN_SETTINGS_ERRORS = new Set([
  "invalid_month",
  "invalid_client",
  "client_exists",
  "unknown_client",
  "name_required",
  "reason_required",
  "no_cells",
  "too_many_cells",
  "too_many_rows",
  "no_rows",
  "not_authorized",
  "unknown_zone",
  "invalid_hours",
]);

/**
 * An audit action as copy. The action column is written by SQL, so a future
 * migration can add a verb this build has never heard of — an unknown one is
 * shown verbatim rather than as a missing-key path.
 */
const KNOWN_AUDIT_ACTIONS = new Set([
  "create",
  "update",
  "recompute",
  "apply",
  "reset",
  "open",
]);

function auditActionLabel(t: (key: string) => string, action: string): string {
  return KNOWN_AUDIT_ACTIONS.has(action) ? t(`audit.action_${action}`) : action;
}

function errorText(t: (key: string) => string, code: string): string {
  return t(`errors.${KNOWN_SETTINGS_ERRORS.has(code) ? code : "unknown"}`);
}

/** One line of the change log, without dumping the whole jsonb on the screen. */
function summariseAudit(after: unknown): string {
  if (!after || typeof after !== "object") return "—";
  const o = after as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof o.ruleCount === "number") parts.push(`${o.ruleCount} rules`);
  if (typeof o.name === "string") parts.push(o.name);
  if (typeof o.reason === "string") parts.push(o.reason);
  if (typeof o.action === "string") parts.push(o.action);
  if (typeof o.categoryOverride === "string") parts.push(o.categoryOverride);
  return parts.length ? parts.join(" · ") : "—";
}
