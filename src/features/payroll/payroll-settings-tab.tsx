"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { ToggleChip } from "@/components/app/toggle-chip";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
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
  RULE_KIND_TO_STATUS,
  RULE_RESULT_KINDS,
  type PayrollClientConfig,
  type PayrollRule,
  type PayrollRuleCondition,
  type RuleResultKind,
  type ZoneCategory,
} from "./payroll-rules-engine";
import {
  conditionsToColumns,
  columnsToConditions,
  readsAs,
  summariseAudit,
  type RuleTableRow,
  type ZoneCategoryColumn,
} from "./payroll-rule-table-model";
import {
  useAddPayrollClient,
  useDeletePayrollClient,
  useOpenPayrollRuleMonth,
  usePayrollRuleConfig,
  usePayrollZoneSettings,
  useRecomputePayrollZoneMetrics,
  useResetPayrollClientRules,
  useSavePayrollClient,
  useSavePayrollClientRules,
  useSavePayrollZoneOverride,
  useSavePayrollZoneSettings,
} from "./use-payroll";
import type { PayrollRiderRow, PayrollZoneMetricRow } from "./payroll-types";

type RuleDraft = {
  uid: string;
  label: string;
  conditions: PayrollRuleCondition[];
  result: { kind: RuleResultKind; hours: number | null };
};

type SettingsView = "client" | "zones";

const ZONE_CAT_OPTIONS: ZoneCategoryColumn[] = ["any", "good", "average", "low", "good_or_average"];

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

function usesOf(client: PayrollClientConfig | null) {
  return {
    usesZone: client?.usesZone ?? false,
    usesOrders: client?.usesOrders ?? false,
    usesHours: client?.usesHours ?? false,
  };
}

function rulesSignature(rules: readonly RuleDraft[]): string {
  return JSON.stringify(
    rules.map((rule) => ({
      label: rule.label,
      conditions: rule.conditions,
      result: rule.result,
    })),
  );
}

/**
 * Settings tab — SOP §5.5 / §8 and the v4 reference: per-criterion rule table,
 * autosave, a Zones & efficiency view, and a readable change log.
 */
export function PayrollSettingsTab({
  month,
  zoneMetrics,
  canManage,
  riders = [],
}: {
  month: PayrollMonthMeta;
  zoneMetrics: readonly PayrollZoneMetricRow[];
  canManage: boolean;
  riders?: readonly PayrollRiderRow[];
}) {
  const t = useTranslations("pages.payroll.settings");
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
  const deleteClient = useDeletePayrollClient();
  const zoneSettingsQuery = usePayrollZoneSettings(month.key);
  const saveZoneSettings = useSavePayrollZoneSettings();

  const [view, setView] = useState<SettingsView>("client");
  const [clientKey, setClientKey] = useState<string | null>(null);
  const [clientDraft, setClientDraft] = useState<PayrollClientConfig | null>(null);
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCopy, setAddCopy] = useState("none");
  const [addUsesZone, setAddUsesZone] = useState(true);
  const [addUsesOrders, setAddUsesOrders] = useState(true);
  const [addUsesHours, setAddUsesHours] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [simZoneName, setSimZoneName] = useState("any");
  const [simZone, setSimZone] = useState<ZoneCategory>("good");
  const [simOrders, setSimOrders] = useState("6");
  const [simHours, setSimHours] = useState("12");
  const [saveFlash, setSaveFlash] = useState<"idle" | "saving" | "saved">("idle");

  const skipRulesSave = useRef(true);
  const lastRulesSig = useRef("");
  const clientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rulesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clients = useMemo(() => config.data?.clients ?? [], [config.data?.clients]);
  const zoneNames = useMemo(
    () => [...new Set(zoneMetrics.map((z) => z.zoneName).filter(Boolean))],
    [zoneMetrics],
  );

  useEffect(() => {
    if (clientKey || !clients.length) return;
    setClientKey(clients[0].key);
  }, [clientKey, clients]);

  useEffect(() => {
    if (!canManage || !config.data || !clients.length) return;
    if (clients.some((c) => c.hasRulesForMonth)) return;
    openMonth.mutate({ monthKey: month.key });
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
    skipRulesSave.current = true;
    const forClient = (config.data?.rules ?? []).filter((r) => r.clientKey === clientKey);
    const next = forClient.map(draftFromRule);
    setRules(next);
    lastRulesSig.current = rulesSignature(next);
  }, [config.data?.rules, clientKey]);

  const uses = usesOf(clientDraft);

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
    const facts = {
      zoneName: simZoneName === "any" ? null : simZoneName,
      zoneCategory: simZone,
      orders,
      hours,
    };
    if (!client) {
      const outcome = evalDay({
        date: `${month.key}-01`,
        today: `${month.key}-28`,
        client: null,
        rules: [],
        zoneName: facts.zoneName,
        zoneCategory: simZone,
        loggedHours: hours,
        orders,
        cover: null,
        coverApproved: false,
        hasCheckIn: hours > 0,
        adjustment: null,
      });
      return { via: "legacy" as const, n: 0, label: "", status: outcome.status, hours: outcome.hours };
    }
    const rule = firstMatchingRule(list, facts);
    if (rule) {
      const status = RULE_KIND_TO_STATUS[rule.result.kind];
      return {
        via: "rule" as const,
        n: list.indexOf(rule) + 1,
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
      n: 0,
      label: "",
      status,
      hours: hoursForStatus(status, {
        client,
        loggedHours: hours,
        customHours: client.defaultResult.hours ?? null,
      }),
    };
  }, [simOrders, simHours, simZone, simZoneName, clientDraft, clientKey, rules, month.key]);

  function markSaving() {
    setSaveFlash("saving");
  }
  function markSaved() {
    setSaveFlash("saved");
    window.setTimeout(() => setSaveFlash("idle"), 1200);
  }

  function persistClient(draft: PayrollClientConfig) {
    if (!canManage) return;
    markSaving();
    saveClient.mutate(
      {
        key: draft.key,
        name: draft.name,
        usesZone: draft.usesZone,
        usesOrders: draft.usesOrders,
        usesHours: draft.usesHours,
        fullDayHours: draft.fullDayHours,
        halfDayHours: draft.halfDayHours,
        reducedHours: draft.reducedHours,
        requiredHoursPerDay: draft.requiredHoursPerDay,
        defaultOffDays: draft.defaultOffDays,
        defaultResult: draft.defaultResult.kind,
        goodThreshold: draft.goodThreshold,
        averageThreshold: draft.averageThreshold,
        sortOrder: draft.sortOrder,
      },
      {
        onSuccess: (result) => {
          if ("error" in result) toast.error(errorText(t, result.error));
          else markSaved();
        },
        onError: () => toast.error(t("errors.unknown")),
      },
    );
  }

  function queueClientSave(draft: PayrollClientConfig) {
    if (!canManage) return;
    if (clientTimer.current) clearTimeout(clientTimer.current);
    clientTimer.current = setTimeout(() => persistClient(draft), 400);
  }

  function patchClient(patch: Partial<PayrollClientConfig>) {
    setClientDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      queueClientSave(next);
      return next;
    });
  }

  function persistRules(list: RuleDraft[]) {
    if (!clientKey || !canManage) return;
    const sig = rulesSignature(list);
    if (sig === lastRulesSig.current) return;
    lastRulesSig.current = sig;
    markSaving();
    saveRules.mutate(
      {
        clientKey,
        monthKey: month.key,
        rules: list.map((r, index) => ({
          label: r.label,
          conditions: { all: r.conditions },
          result: r.result,
          sortOrder: index + 1,
        })),
      },
      {
        onSuccess: (result) => {
          if ("error" in result) toast.error(errorText(t, result.error));
          else markSaved();
        },
        onError: () => toast.error(t("errors.unknown")),
      },
    );
  }

  useEffect(() => {
    if (skipRulesSave.current) {
      skipRulesSave.current = false;
      return;
    }
    if (!canManage || !clientKey) return;
    if (rulesTimer.current) clearTimeout(rulesTimer.current);
    rulesTimer.current = setTimeout(() => persistRules(rules), 450);
    return () => {
      if (rulesTimer.current) clearTimeout(rulesTimer.current);
    };
    // persistRules is stable enough for this debounce; rules is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, canManage, clientKey]);

  function doReset() {
    if (!clientKey || !canManage) return;
    resetRules.mutate(
      { clientKey, monthKey: month.key },
      {
        onSuccess: (result) =>
          "error" in result ? toast.error(errorText(t, result.error)) : toast.success(t("rulesReset")),
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
        usesZone: addUsesZone,
        usesOrders: addUsesOrders,
        usesHours: addUsesHours,
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

  function doDeleteClient() {
    if (!selected || !canManage) return;
    deleteClient.mutate(
      { key: selected.key },
      {
        onSuccess: (result) => {
          if ("error" in result) {
            toast.error(errorText(t, result.error));
            return;
          }
          toast.success(t("delete.deleted", { name: selected.name }));
          setClientKey(null);
          setDeleteOpen(false);
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

  function patchRuleRow(index: number, patch: Partial<RuleTableRow> & { label?: string }) {
    setRules((prev) =>
      prev.map((rule, i) => {
        if (i !== index) return rule;
        const current = conditionsToColumns(rule.conditions, rule.result);
        const nextRow: RuleTableRow = {
          ...current,
          ...patch,
          result: patch.result ?? current.result,
        };
        return {
          ...rule,
          label: patch.label ?? rule.label,
          conditions: columnsToConditions(nextRow, uses),
          result: { kind: nextRow.result.kind, hours: nextRow.result.hours ?? null },
        };
      }),
    );
  }

  const busy =
    saveClient.isPending || saveRules.isPending || saveZoneSettings.isPending || saveOverride.isPending;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-[12px] leading-5 shadow-sm">
        <b>{t("bannerTitle")}</b> {t("bannerBody", { month: month.label })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {clients.map((client) => (
          <ToggleChip
            key={client.key}
            selected={view === "client" && clientKey === client.key}
            icon={Building2}
            onClick={() => {
              setView("client");
              setClientKey(client.key);
            }}
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
        <ToggleChip
          selected={view === "zones"}
          icon={MapPin}
          onClick={() => setView("zones")}
        >
          {t("nav.zones")}
        </ToggleChip>
        {canManage ? (
          <Button type="button" className="ms-auto h-9" onClick={() => setAddOpen((prev) => !prev)}>
            <Plus className="size-3.5" />
            {t("addClient.open")}
          </Button>
        ) : null}
      </div>

      {addOpen && canManage ? (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-2">
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
                      {t("addClient.copyOf", { name: client.name })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ToggleChip selected={addUsesZone} icon={MapPin} onClick={() => setAddUsesZone((v) => !v)}>
              {t("criteria.usesZone")}
            </ToggleChip>
            <ToggleChip selected={addUsesOrders} icon={Check} onClick={() => setAddUsesOrders((v) => !v)}>
              {t("criteria.usesOrders")}
            </ToggleChip>
            <ToggleChip selected={addUsesHours} icon={History} onClick={() => setAddUsesHours((v) => !v)}>
              {t("criteria.usesHours")}
            </ToggleChip>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-9" onClick={() => setAddOpen(false)}>
              {t("addClient.cancel")}
            </Button>
            <Button type="button" className="h-9" disabled={addClient.isPending} onClick={doAddClient}>
              {addClient.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {t("addClient.save")}
            </Button>
          </div>
        </div>
      ) : null}

      {view === "zones" ? (
        <ZonesView
          month={month}
          zoneMetrics={zoneMetrics}
          riders={riders}
          canManage={canManage}
          settings={zoneSettingsQuery.data}
          busy={recompute.isPending || saveZoneSettings.isPending}
          onRecompute={() =>
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
          onSaveSettings={(input) =>
            saveZoneSettings.mutate(
              { monthKey: month.key, ...input },
              {
                onSuccess: (result) => {
                  if ("error" in result) toast.error(errorText(t, result.error));
                  else markSaved();
                },
                onError: () => toast.error(t("errors.unknown")),
              },
            )
          }
          onSaveOverride={(zone, input) =>
            saveOverride.mutate(
              { zoneId: zone.zoneId, monthKey: month.key, ...input },
              {
                onSuccess: (result) => {
                  if ("error" in result) toast.error(errorText(t, result.error));
                  else markSaved();
                },
                onError: () => toast.error(t("errors.unknown")),
              },
            )
          }
        />
      ) : clientDraft ? (
        <>
          <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold">{clientDraft.name}</h3>
                <span className="rounded-sm bg-primary/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-primary">
                  {t("clientRulesTag")}
                </span>
                {saveFlash === "saving" || busy ? (
                  <span className="text-[10px] text-muted-foreground">{t("autosave.saving")}</span>
                ) : saveFlash === "saved" ? (
                  <span className="text-[10px] text-emerald-700">{t("autosave.saved")}</span>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
              <div className="space-y-1 lg:col-span-2">
                <Label htmlFor="payroll-client-name" className="text-[11px]">
                  {t("criteria.name")}
                </Label>
                <Input
                  id="payroll-client-name"
                  className="h-9"
                  value={clientDraft.name}
                  disabled={!canManage}
                  onChange={(e) => patchClient({ name: e.target.value })}
                />
              </div>
              <NumberField
                id="payroll-full-hours"
                label={t("criteria.fullDayHours")}
                value={clientDraft.fullDayHours}
                disabled={!canManage}
                onCommit={(v) => patchClient({ fullDayHours: v })}
              />
              <NumberField
                id="payroll-half-hours"
                label={t("criteria.halfDayHours")}
                value={clientDraft.halfDayHours}
                disabled={!canManage}
                onCommit={(v) => patchClient({ halfDayHours: v })}
              />
              <NumberField
                id="payroll-reduced-hours"
                label={t("criteria.reducedHours")}
                value={clientDraft.reducedHours}
                disabled={!canManage}
                onCommit={(v) => patchClient({ reducedHours: v })}
              />
              <NumberField
                id="payroll-required-hours"
                label={t("criteria.requiredHoursPerDay")}
                value={clientDraft.requiredHoursPerDay}
                disabled={!canManage}
                onCommit={(v) => patchClient({ requiredHoursPerDay: v })}
              />
              <NumberField
                id="payroll-default-off"
                label={t("criteria.defaultOffDays")}
                value={clientDraft.defaultOffDays}
                step="1"
                disabled={!canManage}
                onCommit={(v) => patchClient({ defaultOffDays: Math.round(v) })}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <ToggleChip
                selected={clientDraft.usesZone}
                icon={MapPin}
                onClick={() => canManage && patchClient({ usesZone: !clientDraft.usesZone })}
              >
                {t("criteria.usesZone")}
              </ToggleChip>
              <ToggleChip
                selected={clientDraft.usesOrders}
                icon={Check}
                onClick={() => canManage && patchClient({ usesOrders: !clientDraft.usesOrders })}
              >
                {t("criteria.usesOrders")}
              </ToggleChip>
              <ToggleChip
                selected={clientDraft.usesHours}
                icon={History}
                onClick={() => canManage && patchClient({ usesHours: !clientDraft.usesHours })}
              >
                {t("criteria.usesHours")}
              </ToggleChip>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[13px] font-semibold">{t("rules.title", { month: month.label })}</h3>
                <p className="text-[10px] text-muted-foreground">{t("rules.hint")}</p>
              </div>
              {canManage ? (
                <div className="flex flex-wrap gap-2">
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
                          conditions: columnsToConditions(
                            { ...conditionsToColumns([], { kind: "12", hours: null }), result: { kind: "12", hours: null } },
                            uses,
                          ),
                          result: { kind: "12", hours: null },
                        },
                      ])
                    }
                  >
                    <Plus className="size-3.5" />
                    {t("rules.addRule")}
                  </Button>
                  <Button type="button" variant="outline" className="h-9" disabled={resetRules.isPending} onClick={doReset}>
                    <RotateCcw className="size-3.5" />
                    {t("rules.reset")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 text-destructive hover:bg-destructive/10"
                    disabled={!selected || selected.isSystem || selected.riderCount > 0}
                    title={
                      selected?.isSystem
                        ? t("delete.system")
                        : selected && selected.riderCount > 0
                          ? t("delete.hasRiders")
                          : undefined
                    }
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="size-3.5" />
                    {t("delete.open")}
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="overflow-x-auto">
              <table className="w-max min-w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("rules.order")}</th>
                    {uses.usesZone ? (
                      <>
                        <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("rules.colZoneCategory")}</th>
                        <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("rules.colZone")}</th>
                      </>
                    ) : null}
                    {uses.usesHours ? (
                      <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("rules.colHours")}</th>
                    ) : null}
                    {uses.usesOrders ? (
                      <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("rules.colOrders")}</th>
                    ) : null}
                    <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("rules.colThen")}</th>
                    <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("rules.colReadsAs")}</th>
                    <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("rules.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-xs text-muted-foreground">
                        {t("rules.empty")}
                      </td>
                    </tr>
                  ) : (
                    rules.map((rule, index) => {
                      const row = conditionsToColumns(rule.conditions, rule.result);
                      return (
                        <tr key={rule.uid} className="border-b border-border/60 align-top">
                          <td className="px-2 py-2 text-center font-semibold tabular-nums">{index + 1}</td>
                          {uses.usesZone ? (
                            <>
                              <td className="px-2 py-2">
                                <Select
                                  value={row.zoneCategory}
                                  onValueChange={(value) =>
                                    patchRuleRow(index, { zoneCategory: value as ZoneCategoryColumn })
                                  }
                                >
                                  <SelectTrigger className="h-9 w-40" disabled={!canManage}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ZONE_CAT_OPTIONS.map((option) => (
                                      <SelectItem key={option} value={option}>
                                        {t(`zoneCat.${option}`)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-2 py-2">
                                <Select
                                  value={row.zone}
                                  onValueChange={(value) => patchRuleRow(index, { zone: value ?? "any" })}
                                >
                                  <SelectTrigger className="h-9 w-40" disabled={!canManage}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="any">{t("zoneCat.any")}</SelectItem>
                                    {zoneNames.map((name) => (
                                      <SelectItem key={name} value={name}>
                                        {name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                            </>
                          ) : null}
                          {uses.usesHours ? (
                            <td className="px-2 py-2">
                              <HoursRangeInputs
                                row={row}
                                disabled={!canManage}
                                onChange={(patch) => patchRuleRow(index, patch)}
                              />
                            </td>
                          ) : null}
                          {uses.usesOrders ? (
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-1">
                                <Input
                                  className="h-9 w-16"
                                  inputMode="numeric"
                                  placeholder="min"
                                  value={row.ordersMin ?? ""}
                                  disabled={!canManage}
                                  onChange={(e) =>
                                    patchRuleRow(index, {
                                      ordersMin: e.target.value === "" ? null : Number(e.target.value),
                                    })
                                  }
                                />
                                <span className="text-[10px] text-muted-foreground">–</span>
                                <Input
                                  className="h-9 w-16"
                                  inputMode="numeric"
                                  placeholder="max"
                                  value={row.ordersMax ?? ""}
                                  disabled={!canManage}
                                  onChange={(e) =>
                                    patchRuleRow(index, {
                                      ordersMax: e.target.value === "" ? null : Number(e.target.value),
                                    })
                                  }
                                />
                              </div>
                            </td>
                          ) : null}
                          <td className="px-2 py-2">
                            <div className="flex flex-col gap-1">
                              <Select
                                value={rule.result.kind}
                                onValueChange={(kind) =>
                                  patchRuleRow(index, {
                                    result: { kind: kind as RuleResultKind, hours: rule.result.hours },
                                  })
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
                                  className="h-9 w-24"
                                  inputMode="decimal"
                                  value={rule.result.hours ?? ""}
                                  disabled={!canManage}
                                  onChange={(e) =>
                                    patchRuleRow(index, {
                                      result: {
                                        kind: "CUS",
                                        hours: e.target.value === "" ? null : Number(e.target.value),
                                      },
                                    })
                                  }
                                />
                              ) : null}
                            </div>
                          </td>
                          <td className="max-w-[220px] px-2 py-2 text-[11px] leading-4 text-muted-foreground">
                            {readsAs(row, uses) || "—"}
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
                                  onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))}
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })
                  )}
                  <tr className="bg-muted/20">
                    <td className="px-2 py-2 text-[11px] font-semibold" colSpan={uses.usesZone ? 3 : 1}>
                      {t("rules.defaultRow")}
                    </td>
                    {uses.usesHours ? <td /> : null}
                    {uses.usesOrders ? <td /> : null}
                    <td className="px-2 py-2">
                      <Select
                        value={clientDraft.defaultResult.kind}
                        onValueChange={(kind) =>
                          patchClient({ defaultResult: { kind: kind as RuleResultKind, hours: null } })
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
                    </td>
                    <td className="px-2 py-2 text-[11px] text-muted-foreground">{t("criteria.defaultHint")}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-1.5">
              <FlaskConical className="size-3.5 text-primary" />
              <h3 className="text-[13px] font-semibold">{t("simulator.title")}</h3>
            </div>
            <p className="text-[10px] leading-4 text-muted-foreground">{t("simulator.hint")}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">{t("simulator.zone")}</Label>
                <Select
                  value={simZoneName}
                  onValueChange={(value) => {
                    const name = value ?? "any";
                    setSimZoneName(name);
                    const match = zoneMetrics.find((z) => z.zoneName === name);
                    if (match) setSimZone(match.categoryOverride ?? match.categoryAuto);
                  }}
                >
                  <SelectTrigger className="h-9 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{t("zoneCat.any")}</SelectItem>
                    {zoneNames.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
              <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/50 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
                <span className="font-semibold">
                  {simulator.via === "rule"
                    ? t("simulator.rulePill", { n: simulator.n, hours: simulator.hours })
                    : simulator.via === "default"
                      ? t("simulator.decidedByDefault")
                      : t("simulator.decidedByLegacy")}
                </span>
                <span className="text-[11px]">
                  {t("simulator.outcome", {
                    status: tDayStatus(simulator.status),
                    hours: simulator.hours,
                  })}
                </span>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

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
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("audit.change")}</th>
              </tr>
            </thead>
            <tbody>
              {(config.data?.audit ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    {t("audit.empty")}
                  </td>
                </tr>
              ) : (
                (config.data?.audit ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{row.createdAt}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.actorName}</td>
                    <td className="px-2 py-1.5 text-[11px] text-muted-foreground">
                      {summariseAudit({
                        entity: row.entity,
                        action: row.action,
                        clientKey: row.clientKey,
                        before: row.before,
                        after: row.after,
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && canManage ? (
        <ConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          itemTitle={t("delete.title")}
          itemName={selected.name}
          confirmText={selected.name}
          warning={t("delete.warning")}
          onConfirm={doDeleteClient}
          isPending={deleteClient.isPending}
        />
      ) : null}
    </div>
  );
}

function HoursRangeInputs({
  row,
  disabled,
  onChange,
}: {
  row: RuleTableRow;
  disabled: boolean;
  onChange: (patch: Partial<RuleTableRow>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Select
        value={row.hoursMinOp}
        onValueChange={(op) => onChange({ hoursMinOp: (op as "gte" | "gt") ?? "gte" })}
      >
        <SelectTrigger className="h-9 w-16" disabled={disabled}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="gte">≥</SelectItem>
          <SelectItem value="gt">&gt;</SelectItem>
        </SelectContent>
      </Select>
      <Input
        className="h-9 w-14"
        inputMode="decimal"
        value={row.hoursMin ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ hoursMin: e.target.value === "" ? null : Number(e.target.value) })}
      />
      <span className="text-[10px] text-muted-foreground">and</span>
      <Select
        value={row.hoursMaxOp}
        onValueChange={(op) => onChange({ hoursMaxOp: (op as "lt" | "lte") ?? "lt" })}
      >
        <SelectTrigger className="h-9 w-16" disabled={disabled}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="lt">&lt;</SelectItem>
          <SelectItem value="lte">≤</SelectItem>
        </SelectContent>
      </Select>
      <Input
        className="h-9 w-14"
        inputMode="decimal"
        value={row.hoursMax ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ hoursMax: e.target.value === "" ? null : Number(e.target.value) })}
      />
    </div>
  );
}

function ZonesView({
  month,
  zoneMetrics,
  riders,
  canManage,
  settings,
  busy,
  onRecompute,
  onSaveSettings,
  onSaveOverride,
}: {
  month: PayrollMonthMeta;
  zoneMetrics: readonly PayrollZoneMetricRow[];
  riders: readonly PayrollRiderRow[];
  canManage: boolean;
  settings:
    | {
        targetDpdOverride: number | null;
        goodThreshold: number;
        averageThreshold: number;
        autoTargetDpd: number | null;
      }
    | undefined;
  busy: boolean;
  onRecompute: () => void;
  onSaveSettings: (input: {
    targetDpdOverride: number | null;
    goodThreshold: number;
    averageThreshold: number;
  }) => void;
  onSaveOverride: (
    zone: PayrollZoneMetricRow,
    input: {
      dpdUsed: number | null;
      targetDpdUsed: number | null;
      categoryOverride: "good" | "average" | "low" | null;
      efficiencyOverride: number | null;
    },
  ) => void;
}) {
  const t = useTranslations("pages.payroll.settings");
  const tZoneCategory = useTranslations("pages.payroll.zoneCategory");
  const [targetDraft, setTargetDraft] = useState(
    settings?.targetDpdOverride == null ? "" : String(settings.targetDpdOverride),
  );
  const [goodDraft, setGoodDraft] = useState(String(settings?.goodThreshold ?? 110));
  const [avgDraft, setAvgDraft] = useState(String(settings?.averageThreshold ?? 70));

  useEffect(() => {
    setTargetDraft(settings?.targetDpdOverride == null ? "" : String(settings.targetDpdOverride));
    setGoodDraft(String(settings?.goodThreshold ?? 110));
    setAvgDraft(String(settings?.averageThreshold ?? 70));
  }, [settings?.targetDpdOverride, settings?.goodThreshold, settings?.averageThreshold]);

  function commitSettings() {
    if (!canManage) return;
    onSaveSettings({
      targetDpdOverride: targetDraft.trim() === "" ? null : Number(targetDraft),
      goodThreshold: Number(goodDraft) || 110,
      averageThreshold: Number(avgDraft) || 70,
    });
  }

  const noZone = noZoneAggregate(riders, t("zones.noZone"));
  const rows = [...zoneMetrics, noZone];

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold">{t("zones.title")}</h3>
          <p className="text-[10px] text-muted-foreground">{t("zones.hint")}</p>
        </div>
        {canManage ? (
          <Button type="button" variant="outline" className="h-9" disabled={busy} onClick={onRecompute}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
            {t("zones.recompute")}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-[11px]">{t("zones.targetDpd")}</Label>
          <div className="flex items-center gap-1.5">
            <Input
              className="h-9 w-24"
              inputMode="decimal"
              placeholder={t("zones.auto")}
              value={targetDraft}
              disabled={!canManage}
              onChange={(e) => setTargetDraft(e.target.value)}
              onBlur={commitSettings}
            />
            <span className="text-[10px] text-muted-foreground">
              {t("zones.autoEq", {
                value: settings?.autoTargetDpd == null ? "—" : settings.autoTargetDpd.toFixed(2),
              })}
            </span>
          </div>
        </div>
        <NumberField
          id="payroll-zone-good"
          label={t("zones.goodThreshold")}
          value={Number(goodDraft) || 110}
          disabled={!canManage}
          onCommit={(v) => {
            setGoodDraft(String(v));
            onSaveSettings({
              targetDpdOverride: targetDraft.trim() === "" ? null : Number(targetDraft),
              goodThreshold: v,
              averageThreshold: Number(avgDraft) || 70,
            });
          }}
        />
        <NumberField
          id="payroll-zone-avg"
          label={t("zones.averageThreshold")}
          value={Number(avgDraft) || 70}
          disabled={!canManage}
          onCommit={(v) => {
            setAvgDraft(String(v));
            onSaveSettings({
              targetDpdOverride: targetDraft.trim() === "" ? null : Number(targetDraft),
              goodThreshold: Number(goodDraft) || 110,
              averageThreshold: v,
            });
          }}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-max min-w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.zone")}</th>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.riders")}</th>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.monthOrders")}</th>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.dpd")}</th>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.efficiencyAuto")}</th>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.efficiencyUsed")}</th>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.categoryAuto")}</th>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.manualOverride")}</th>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("zones.finalCategory")}</th>
            </tr>
          </thead>
          <tbody>
            {zoneMetrics.length === 0 && riders.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {t("zones.empty")}
                </td>
              </tr>
            ) : (
              rows.map((zone) => {
                const readOnly = !zone.zoneId;
                const used = zone.efficiencyOverride ?? zone.efficiency;
                const finalCat = zone.categoryOverride ?? zone.categoryAuto;
                return (
                  <tr key={zone.zoneId || "no-zone"} className="border-b border-border/60">
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium">{zone.zoneName}</td>
                    <td className="px-2 py-1.5 tabular-nums">{zone.riderDays}</td>
                    <td className="px-2 py-1.5 tabular-nums">{zone.orders}</td>
                    <td className="px-2 py-1.5 tabular-nums">{zone.dpd == null ? "—" : zone.dpd.toFixed(2)}</td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {zone.efficiency == null ? "—" : formatPayrollPct(zone.efficiency)}
                    </td>
                    <td className="px-2 py-1.5">
                      {readOnly || !canManage ? (
                        <span className="tabular-nums">{used == null ? "—" : formatPayrollPct(used)}</span>
                      ) : (
                        <EfficiencyUsedEditor
                          zone={zone}
                          busy={busy}
                          onSave={(efficiencyOverride) =>
                            onSaveOverride(zone, {
                              dpdUsed: zone.dpdUsed,
                              targetDpdUsed: zone.targetDpdUsed,
                              categoryOverride: zone.categoryOverride,
                              efficiencyOverride,
                            })
                          }
                        />
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <ZoneCategoryPillSmall
                        category={zone.categoryAuto}
                        label={tZoneCategory(zone.categoryAuto)}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {readOnly || !canManage ? (
                        <span className="text-[11px] text-muted-foreground">
                          {zone.categoryOverride ? tZoneCategory(zone.categoryOverride) : t("zones.auto")}
                        </span>
                      ) : (
                        <Select
                          value={zone.categoryOverride ?? "auto"}
                          onValueChange={(value) =>
                            onSaveOverride(zone, {
                              dpdUsed: zone.dpdUsed,
                              targetDpdUsed: zone.targetDpdUsed,
                              categoryOverride:
                                value === "auto" || !value
                                  ? null
                                  : (value as "good" | "average" | "low"),
                              efficiencyOverride: zone.efficiencyOverride,
                            })
                          }
                        >
                          <SelectTrigger className="h-9 w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">{t("zones.auto")}</SelectItem>
                            <SelectItem value="good">{tZoneCategory("good")}</SelectItem>
                            <SelectItem value="average">{tZoneCategory("average")}</SelectItem>
                            <SelectItem value="low">{tZoneCategory("low")}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <ZoneCategoryPillSmall category={finalCat} label={tZoneCategory(finalCat)} />
                        {zone.categoryOverride ? (
                          <span className="rounded-sm bg-amber-100 px-1 text-[9px] font-bold uppercase text-amber-800">
                            {t("zones.manualTag")}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground">{t("zones.monthNote", { month: month.label })}</p>
    </div>
  );
}

function EfficiencyUsedEditor({
  zone,
  busy,
  onSave,
}: {
  zone: PayrollZoneMetricRow;
  busy: boolean;
  onSave: (efficiencyOverride: number | null) => void;
}) {
  const t = useTranslations("pages.payroll.settings");
  const [value, setValue] = useState(
    zone.efficiencyOverride == null ? "" : String(zone.efficiencyOverride),
  );
  useEffect(() => {
    setValue(zone.efficiencyOverride == null ? "" : String(zone.efficiencyOverride));
  }, [zone.efficiencyOverride]);
  return (
    <div className="flex items-center gap-1">
      <Input
        className="h-9 w-20"
        inputMode="decimal"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const next = value.trim() === "" ? null : Number(value);
          const prev = zone.efficiencyOverride;
          if (next === prev || (next == null && prev == null)) return;
          if (next != null && !Number.isFinite(next)) return;
          onSave(next);
        }}
      />
      {zone.efficiencyOverride != null ? (
        <>
          <span className="rounded-sm bg-amber-100 px-1 text-[9px] font-bold uppercase text-amber-800">
            {t("zones.editedTag")}
          </span>
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-md px-1.5 text-[10px] font-semibold text-primary hover:bg-primary/10"
            onClick={() => onSave(null)}
          >
            <RotateCcw className="size-3" />
          </button>
        </>
      ) : null}
    </div>
  );
}

function noZoneAggregate(riders: readonly PayrollRiderRow[], label: string): PayrollZoneMetricRow {
  const none = riders.filter((r) => !r.zoneId);
  const riderDays = none.reduce(
    (sum, row) => sum + row.days.filter((status) => status !== "blank").length,
    0,
  );
  const orders = none.reduce((sum, row) => sum + row.finalOrders, 0);
  const dpd = riderDays > 0 ? orders / riderDays : null;
  return {
    zoneId: "",
    zoneName: label,
    orders,
    riderDays,
    dpd,
    targetDpd: null,
    dpdUsed: null,
    targetDpdUsed: null,
    efficiency: null,
    categoryAuto: "not_set",
    categoryOverride: null,
    efficiencyOverride: null,
    goodThreshold: 110,
    averageThreshold: 70,
    computedAt: null,
  };
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

function NumberField({
  id,
  label,
  value,
  step = "0.5",
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  step?: string;
  disabled?: boolean;
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
        disabled={disabled}
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
  "client_has_riders",
  "system_client",
  "invalid_thresholds",
]);

function errorText(t: (key: string) => string, code: string): string {
  const match = KNOWN_SETTINGS_ERRORS.has(code) ? code : [...KNOWN_SETTINGS_ERRORS].find((k) => code.includes(k));
  return t(`errors.${match ?? "unknown"}`);
}
