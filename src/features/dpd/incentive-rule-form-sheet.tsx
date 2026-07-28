"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { queryKeys } from "@/lib/query/query-keys";
import { selectOptionsFrom } from "@/lib/select-items";
import { isDpdErrorKey, saveIncentiveRule } from "./dpd-actions";
import type { DpdErrorKey } from "./dpd-errors";
import {
  hasIncentiveRuleValidationErrors,
  validateIncentiveRuleForm,
  type IncentiveRuleFormErrors,
  type IncentiveRuleFormField,
} from "./incentive-rule-form-validation";
import { ScopePicker } from "./scope-picker";
import {
  computeIncentivePreview,
  INCENTIVE_PERIODS,
  INCENTIVE_REWARD_MODES,
  INCENTIVE_TARGET_MODES,
  RULE_STATUSES,
  type DpdScopeOptions,
  type IncentivePayoutMode,
  type IncentiveRewardMode,
  type IncentiveRuleRow,
  type IncentiveTargetMode,
  type IncentivePeriod,
  type RuleScopeType,
  type RuleStatus,
} from "./types";

type TierDraft = {
  key: string;
  threshold_deliveries: string;
  reward_mode: IncentiveRewardMode;
  reward_kwd: string;
  reward_per_delivery_kwd: string;
};

function newTierDraft(): TierDraft {
  return {
    key: crypto.randomUUID(),
    threshold_deliveries: "",
    reward_mode: "fixed",
    reward_kwd: "0",
    reward_per_delivery_kwd: "0",
  };
}

function tiersFromRule(rule: IncentiveRuleRow | null): TierDraft[] {
  if (!rule?.tiers?.length) return [newTierDraft(), newTierDraft()];
  return rule.tiers.map((t) => ({
    key: t.id,
    threshold_deliveries: String(t.threshold_deliveries),
    reward_mode: t.reward_mode,
    reward_kwd: String(t.reward_kwd ?? 0),
    reward_per_delivery_kwd: String(t.reward_per_delivery_kwd ?? 0),
  }));
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-[11px] text-destructive" role="alert">
      {message}
    </p>
  );
}

export function IncentiveRuleFormSheet({
  rule,
  options,
  open,
  onOpenChange,
}: {
  rule: IncentiveRuleRow | null;
  options: DpdScopeOptions | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.dpd");
  const statusSelectItems = selectOptionsFrom(RULE_STATUSES, (s) => s, (s) =>
    t(`status.${s}`),
  );
  const periodSelectItems = selectOptionsFrom(INCENTIVE_PERIODS, (p) => p, (p) =>
    t(`period.${p}`),
  );
  const targetModeSelectItems = selectOptionsFrom(INCENTIVE_TARGET_MODES, (m) => m, (m) =>
    t(`targetTypes.${m}`),
  );
  const rewardModeSelectItems = selectOptionsFrom(INCENTIVE_REWARD_MODES, (m) => m, (m) =>
    t(`rewardTypes.${m}`),
  );
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const isEdit = Boolean(rule);

  const [name, setName] = useState(rule?.name ?? "");
  const [status, setStatus] = useState<RuleStatus>(rule?.status ?? "draft");
  const [scopeType, setScopeType] = useState<RuleScopeType>(rule?.scope_type ?? "zone");
  const [zoneIds, setZoneIds] = useState<string[]>(rule?.zone_ids ?? []);
  const [partnerIds, setPartnerIds] = useState<string[]>(rule?.partner_ids ?? []);
  const [restaurantIds, setRestaurantIds] = useState<string[]>(
    rule?.restaurant_ids ?? [],
  );
  const [startDate, setStartDate] = useState(rule?.start_date ?? "");
  const [endDate, setEndDate] = useState(rule?.end_date ?? "");
  const [priority, setPriority] = useState(String(rule?.priority ?? ""));
  const [period, setPeriod] = useState<IncentivePeriod>(rule?.period ?? "daily");
  const [targetMode, setTargetMode] = useState<IncentiveTargetMode>(
    rule?.target_mode ?? "single",
  );
  const [baseMinimum, setBaseMinimum] = useState(
    String(rule?.base_minimum_deliveries ?? "0"),
  );
  const [targetDeliveries, setTargetDeliveries] = useState(
    String(rule?.target_deliveries ?? "1"),
  );
  const [rewardMode, setRewardMode] = useState<IncentiveRewardMode>(
    rule?.reward_mode ?? "fixed",
  );
  const [rewardKwd, setRewardKwd] = useState(String(rule?.reward_kwd ?? "0"));
  const [rewardPerDeliveryKwd, setRewardPerDeliveryKwd] = useState(
    String(rule?.reward_per_delivery_kwd ?? "0"),
  );
  const [payoutMode, setPayoutMode] = useState<IncentivePayoutMode>(
    rule?.payout_mode ?? "milestone",
  );
  const [overridesOthers, setOverridesOthers] = useState(
    rule?.overrides_others ?? false,
  );
  const [tiers, setTiers] = useState<TierDraft[]>(() => tiersFromRule(rule));
  const [previewCount, setPreviewCount] = useState(
    String(rule?.target_deliveries ?? rule?.tiers.at(-1)?.threshold_deliveries ?? "15"),
  );
  const [fieldErrors, setFieldErrors] = useState<IncentiveRuleFormErrors>({});
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(rule?.name ?? "");
    setStatus(rule?.status ?? "draft");
    setScopeType(rule?.scope_type ?? "zone");
    setZoneIds(rule?.zone_ids ?? []);
    setPartnerIds(rule?.partner_ids ?? []);
    setRestaurantIds(rule?.restaurant_ids ?? []);
    setStartDate(rule?.start_date ?? "");
    setEndDate(rule?.end_date ?? "");
    setPriority(String(rule?.priority ?? ""));
    setPeriod(rule?.period ?? "daily");
    setTargetMode(rule?.target_mode ?? "single");
    setBaseMinimum(String(rule?.base_minimum_deliveries ?? "0"));
    setTargetDeliveries(String(rule?.target_deliveries ?? "1"));
    setRewardMode(rule?.reward_mode ?? "fixed");
    setRewardKwd(String(rule?.reward_kwd ?? "0"));
    setRewardPerDeliveryKwd(String(rule?.reward_per_delivery_kwd ?? "0"));
    setPayoutMode(rule?.payout_mode ?? "milestone");
    setOverridesOthers(rule?.overrides_others ?? false);
    setTiers(tiersFromRule(rule));
    const lastThreshold =
      rule?.target_deliveries ??
      rule?.tiers[rule.tiers.length - 1]?.threshold_deliveries ??
      15;
    setPreviewCount(String(lastThreshold));
    setFieldErrors({});
    setShowErrors(false);
  }, [open, rule]);

  const previewRule = useMemo((): Parameters<typeof computeIncentivePreview>[0] => {
    const base = Number(baseMinimum) || 0;
    if (targetMode === "single") {
      return {
        target_mode: "single",
        base_minimum_deliveries: base,
        target_deliveries: Number(targetDeliveries) || null,
        reward_mode: rewardMode,
        reward_kwd: Number(rewardKwd) || 0,
        reward_per_delivery_kwd: Number(rewardPerDeliveryKwd) || 0,
        payout_mode: payoutMode,
        tiers: [],
      };
    }
    return {
      target_mode: "tiered",
      base_minimum_deliveries: base,
      target_deliveries: null,
      reward_mode: "fixed",
      reward_kwd: 0,
      reward_per_delivery_kwd: null,
      payout_mode: payoutMode,
      tiers: tiers.map((tier, index) => ({
        id: tier.key,
        threshold_deliveries: Number(tier.threshold_deliveries) || 0,
        reward_mode: tier.reward_mode,
        reward_kwd:
          tier.reward_mode === "fixed" ? Number(tier.reward_kwd) || 0 : null,
        reward_per_delivery_kwd:
          tier.reward_mode === "per_delivery"
            ? Number(tier.reward_per_delivery_kwd) || 0
            : null,
        sort_order: index,
      })),
    };
  }, [
    baseMinimum,
    targetMode,
    targetDeliveries,
    rewardMode,
    rewardKwd,
    rewardPerDeliveryKwd,
    payoutMode,
    tiers,
  ]);

  const previewAmount = useMemo(() => {
    const count = Number(previewCount);
    if (!Number.isFinite(count) || count < 0) return 0;
    return computeIncentivePreview(previewRule, count);
  }, [previewRule, previewCount]);

  const errorMessage = (key?: DpdErrorKey) => (key ? t(`errors.${key}`) : undefined);

  const clearFieldError = (field: IncentiveRuleFormField) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const showFieldError = (field: IncentiveRuleFormField) =>
    showErrors ? errorMessage(fieldErrors[field]) : undefined;

  const errorToast = (error?: string) => {
    if (error && isDpdErrorKey(error)) return t(`errors.${error}`);
    return t("errors.save_failed");
  };

  const handleSave = () => {
    const validation = validateIncentiveRuleForm({
      name,
      period,
      scopeType,
      zoneIds,
      partnerIds,
      restaurantIds,
      startDate,
      endDate,
      targetMode,
      baseMinimum,
      targetDeliveries,
      rewardMode,
      rewardKwd,
      rewardPerDeliveryKwd,
      tiers,
    });
    setShowErrors(true);
    setFieldErrors(validation);
    if (hasIncentiveRuleValidationErrors(validation)) {
      const firstKey = Object.values(validation)[0];
      toast.error(errorMessage(firstKey) ?? t("errors.missing_fields"));
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      if (rule?.id) formData.append("id", rule.id);
      formData.append("name", name);
      formData.append("status", status);
      formData.append("scopeType", scopeType);
      const scopeIds =
        scopeType === "zone"
          ? zoneIds
          : scopeType === "partner"
            ? partnerIds
            : restaurantIds;
      formData.append("scopeIdsJson", JSON.stringify(scopeIds));
      formData.append("startDate", startDate);
      formData.append("endDate", endDate);
      if (priority) formData.append("priority", priority);
      formData.append("period", period);
      formData.append("targetMode", targetMode);
      formData.append("baseMinimumDeliveries", baseMinimum);
      formData.append("rewardMode", rewardMode);
      formData.append("targetDeliveries", targetDeliveries);
      formData.append("rewardKwd", rewardKwd);
      formData.append("rewardPerDeliveryKwd", rewardPerDeliveryKwd);
      formData.append("payoutMode", payoutMode);
      formData.append("overridesOthers", overridesOthers ? "true" : "false");

      if (targetMode === "tiered") {
        const tierPayload = tiers.map((tier) => ({
          threshold_deliveries: Number(tier.threshold_deliveries),
          reward_mode: tier.reward_mode,
          reward_kwd: tier.reward_mode === "fixed" ? Number(tier.reward_kwd) : null,
          reward_per_delivery_kwd:
            tier.reward_mode === "per_delivery"
              ? Number(tier.reward_per_delivery_kwd)
              : null,
        }));
        formData.append("tiersJson", JSON.stringify(tierPayload));
      }

      const result = await saveIncentiveRule(formData);
      if (result.error) {
        toast.error(errorToast(result.error), {
          description: result.errorDetail,
          duration: result.errorDetail ? 8000 : 4000,
        });
        return;
      }
      toast.success(isEdit ? t("incentiveUpdated") : t("incentiveCreated"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.dpd.all() });
      onOpenChange(false);
    });
  };

  const title = isEdit ? t("editIncentiveRule") : t("addIncentiveRule");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(92vh,860px)] flex-col gap-0 overflow-visible rounded-xl p-0 sm:max-w-5xl"
        showCloseButton
        closeOutside
      >
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 pt-4 pb-3 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="incentive-name">{t("fields.ruleName")}</Label>
              <Input
                id="incentive-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearFieldError("name");
                }}
                className="rounded-lg"
                aria-invalid={Boolean(showFieldError("name"))}
              />
              <FieldError message={showFieldError("name")} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("fields.status")}</Label>
                <Select
                  items={statusSelectItems}
                  value={status}
                  onValueChange={(v) => v && setStatus(v as RuleStatus)}
                >
                  <SelectTrigger className="w-full cursor-pointer rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RULE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s} label={t(`status.${s}`)}>
                        {t(`status.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("fields.period")}</Label>
                <Select
                  items={periodSelectItems}
                  value={period}
                  onValueChange={(v) => v && setPeriod(v as IncentivePeriod)}
                >
                  <SelectTrigger className="w-full cursor-pointer rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INCENTIVE_PERIODS.map((p) => (
                      <SelectItem key={p} value={p} label={t(`period.${p}`)}>
                        {t(`period.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <ScopePicker
              scopeType={scopeType}
              zoneIds={zoneIds}
              partnerIds={partnerIds}
              restaurantIds={restaurantIds}
              onScopeTypeChange={(v) => {
                setScopeType(v);
                setZoneIds([]);
                setPartnerIds([]);
                setRestaurantIds([]);
                clearFieldError("scopeIds");
              }}
              onZoneIdsChange={(ids) => {
                setZoneIds(ids);
                clearFieldError("scopeIds");
              }}
              onPartnerIdsChange={(ids) => {
                setPartnerIds(ids);
                clearFieldError("scopeIds");
              }}
              onRestaurantIdsChange={(ids) => {
                setRestaurantIds(ids);
                clearFieldError("scopeIds");
              }}
              options={options}
              disabled={isPending}
              scopeError={showFieldError("scopeIds")}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="start-date">{t("fields.startDate")}</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    clearFieldError("startDate");
                    clearFieldError("endDate");
                  }}
                  className="rounded-lg"
                  aria-invalid={Boolean(showFieldError("startDate"))}
                />
                <FieldError message={showFieldError("startDate")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-date">{t("fields.endDate")}</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    clearFieldError("endDate");
                  }}
                  className="rounded-lg"
                  aria-invalid={Boolean(showFieldError("endDate"))}
                />
                <FieldError message={showFieldError("endDate")} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="priority">{t("fields.priority")}</Label>
              <Input
                id="priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                placeholder={t("placeholders.priority")}
                className="rounded-lg"
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="overrides-others" className="text-sm">
                  {t("fields.overridesOthers")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("hints.overridesOthers")}
                </p>
              </div>
              <Switch
                id="overrides-others"
                checked={overridesOthers}
                onCheckedChange={setOverridesOthers}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("fields.targetMode")}</Label>
              <Select
                items={targetModeSelectItems}
                value={targetMode}
                onValueChange={(v) => v && setTargetMode(v as IncentiveTargetMode)}
              >
                <SelectTrigger className="w-full cursor-pointer rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCENTIVE_TARGET_MODES.map((m) => (
                    <SelectItem key={m} value={m} label={t(`targetTypes.${m}`)}>
                      {t(`targetTypes.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="payout-cumulative" className="text-sm">
                  {t("fields.cumulativePayout")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("hints.cumulativePayout")}
                </p>
              </div>
              <Switch
                id="payout-cumulative"
                checked={payoutMode === "cumulative"}
                onCheckedChange={(v) => setPayoutMode(v ? "cumulative" : "milestone")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="base-min">{t("fields.baseMinimumDeliveries")}</Label>
              <Input
                id="base-min"
                type="number"
                min={0}
                value={baseMinimum}
                onChange={(e) => {
                  setBaseMinimum(e.target.value);
                  clearFieldError("baseMinimum");
                  clearFieldError("targetDeliveries");
                  clearFieldError("tiers");
                }}
                className="rounded-lg"
                aria-invalid={Boolean(showFieldError("baseMinimum"))}
              />
              <FieldError message={showFieldError("baseMinimum")} />
              <p className="text-xs text-muted-foreground">
                {t("hints.baseMinimum")}
              </p>
            </div>

            {targetMode === "single" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="target">{t("fields.targetDeliveries")}</Label>
                  <Input
                    id="target"
                    type="number"
                    min={1}
                    value={targetDeliveries}
                    onChange={(e) => {
                      setTargetDeliveries(e.target.value);
                      clearFieldError("targetDeliveries");
                    }}
                    className="rounded-lg"
                    aria-invalid={Boolean(showFieldError("targetDeliveries"))}
                  />
                  <FieldError message={showFieldError("targetDeliveries")} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("fields.rewardMode")}</Label>
                  <Select
                    items={rewardModeSelectItems}
                    value={rewardMode}
                    onValueChange={(v) => v && setRewardMode(v as IncentiveRewardMode)}
                  >
                    <SelectTrigger className="w-full cursor-pointer rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INCENTIVE_REWARD_MODES.map((m) => (
                        <SelectItem key={m} value={m} label={t(`rewardTypes.${m}`)}>
                          {t(`rewardTypes.${m}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {rewardMode === "fixed" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="reward">{t("fields.rewardKwd")}</Label>
                    <Input
                      id="reward"
                      type="number"
                      min={0}
                      step="0.001"
                      value={rewardKwd}
                      onChange={(e) => {
                        setRewardKwd(e.target.value);
                        clearFieldError("rewardKwd");
                      }}
                      className="rounded-lg"
                      aria-invalid={Boolean(showFieldError("rewardKwd"))}
                    />
                    <FieldError message={showFieldError("rewardKwd")} />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="per-delivery">{t("fields.rewardPerDeliveryKwd")}</Label>
                    <Input
                      id="per-delivery"
                      type="number"
                      min={0}
                      step="0.001"
                      value={rewardPerDeliveryKwd}
                      onChange={(e) => {
                        setRewardPerDeliveryKwd(e.target.value);
                        clearFieldError("rewardPerDeliveryKwd");
                      }}
                      className="rounded-lg"
                      aria-invalid={Boolean(showFieldError("rewardPerDeliveryKwd"))}
                    />
                    <FieldError message={showFieldError("rewardPerDeliveryKwd")} />
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label>{t("fields.tieredTargets")}</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="cursor-pointer rounded-lg"
                    onClick={() => setTiers((prev) => [...prev, newTierDraft()])}
                  >
                    <Plus className="h-4 w-4" />
                    {t("addTier")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("hints.cumulativeTiers")}</p>
                <FieldError message={showFieldError("tiers")} />
                <div className="space-y-3">
                  {tiers.map((tier, index) => (
                    <div
                      key={tier.key}
                      className="space-y-3 rounded-lg border border-border p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t("tierLabel", { index: index + 1 })}
                        </span>
                        {tiers.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 cursor-pointer"
                            onClick={() =>
                              setTiers((prev) => prev.filter((x) => x.key !== tier.key))
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>{t("fields.tierThreshold")}</Label>
                          <Input
                            type="number"
                            min={1}
                            value={tier.threshold_deliveries}
                            onChange={(e) => {
                              setTiers((prev) =>
                                prev.map((x) =>
                                  x.key === tier.key
                                    ? { ...x, threshold_deliveries: e.target.value }
                                    : x,
                                ),
                              );
                              clearFieldError("tiers");
                            }}
                            className="rounded-lg"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>{t("fields.rewardMode")}</Label>
                          <Select
                            items={rewardModeSelectItems}
                            value={tier.reward_mode}
                            onValueChange={(v) =>
                              v &&
                              setTiers((prev) =>
                                prev.map((x) =>
                                  x.key === tier.key
                                    ? { ...x, reward_mode: v as IncentiveRewardMode }
                                    : x,
                                ),
                              )
                            }
                          >
                            <SelectTrigger className="w-full cursor-pointer rounded-lg">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {INCENTIVE_REWARD_MODES.map((m) => (
                                <SelectItem key={m} value={m} label={t(`rewardTypes.${m}`)}>
                                  {t(`rewardTypes.${m}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {tier.reward_mode === "fixed" ? (
                        <div className="space-y-1.5">
                          <Label>{t("fields.rewardKwd")}</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.001"
                            value={tier.reward_kwd}
                            onChange={(e) =>
                              setTiers((prev) =>
                                prev.map((x) =>
                                  x.key === tier.key
                                    ? { ...x, reward_kwd: e.target.value }
                                    : x,
                                ),
                              )
                            }
                            className="rounded-lg"
                          />
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <Label>{t("fields.rewardPerDeliveryKwd")}</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.001"
                            value={tier.reward_per_delivery_kwd}
                            onChange={(e) =>
                              setTiers((prev) =>
                                prev.map((x) =>
                                  x.key === tier.key
                                    ? {
                                        ...x,
                                        reward_per_delivery_kwd: e.target.value,
                                      }
                                    : x,
                                ),
                              )
                            }
                            className="rounded-lg"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-2">
              <Label htmlFor="preview-count">{t("fields.payoutPreview")}</Label>
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  id="preview-count"
                  type="number"
                  min={0}
                  value={previewCount}
                  onChange={(e) => setPreviewCount(e.target.value)}
                  className="w-28 rounded-lg"
                />
                <p className="text-sm tabular-nums">
                  {t("payoutPreviewAt", {
                    count: previewCount,
                    amount: previewAmount.toFixed(3),
                  })}
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">{t("stackingHint")}</p>
          </div>
        </div>
        <AppModalFooter title={title} subtitle={t("stackingHint")}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-md"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-9 cursor-pointer rounded-md px-4"
            onClick={handleSave}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
