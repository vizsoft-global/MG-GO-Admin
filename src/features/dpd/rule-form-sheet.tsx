"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { queryKeys } from "@/lib/query/query-keys";
import { selectOptionsFrom } from "@/lib/select-items";
import { isDpdErrorKey, saveDeliveryRule } from "./dpd-actions";
import { ScopePicker } from "./scope-picker";
import {
  INCENTIVE_PERIODS,
  RULE_STATUSES,
  type DeliveryRuleRow,
  type DpdScopeOptions,
  type IncentivePeriod,
  type RuleScopeType,
  type RuleStatus,
} from "./types";

export function RuleFormSheet({
  rule,
  options,
  open,
  onOpenChange,
}: {
  rule: DeliveryRuleRow | null;
  options: DpdScopeOptions | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.dpd");
  const statusSelectItems = selectOptionsFrom(RULE_STATUSES, (s) => s, (s) =>
    t(`status.${s}`),
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
  const [dpdTarget, setDpdTarget] = useState(
    rule?.dpd_target != null ? String(rule.dpd_target) : "",
  );
  const [dpdPeriod, setDpdPeriod] = useState<IncentivePeriod | "">(
    rule?.dpd_period ?? "",
  );

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
    setDpdTarget(rule?.dpd_target != null ? String(rule.dpd_target) : "");
    setDpdPeriod(rule?.dpd_period ?? "");
  }, [open, rule]);

  const errorToast = (error?: string) => {
    if (error && isDpdErrorKey(error)) return t(`errors.${error}`);
    return t("errors.save_failed");
  };

  const handleSave = () => {
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
      formData.append("dpdTarget", dpdTarget);
      formData.append("dpdPeriod", dpdPeriod);

      const result = await saveDeliveryRule(formData);
      if (result.error) {
        toast.error(errorToast(result.error), {
          description: result.errorDetail,
          duration: result.errorDetail ? 8000 : 4000,
        });
        return;
      }
      toast.success(isEdit ? t("deliveryRuleUpdated") : t("deliveryRuleCreated"));

      void queryClient.invalidateQueries({ queryKey: queryKeys.dpd.all() });
      onOpenChange(false);
    });
  };

  const title = isEdit ? t("editDeliveryRule") : t("addDeliveryRule");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-visible rounded-xl p-0 sm:max-w-2xl"
        showCloseButton
        closeOutside
      >
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pt-4 pb-3">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">{t("fields.ruleName")}</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg"
            />
          </div>
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
            }}
            onZoneIdsChange={setZoneIds}
            onPartnerIdsChange={setPartnerIds}
            onRestaurantIdsChange={setRestaurantIds}
            options={options}
            disabled={isPending}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="start-date">{t("fields.startDate")}</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end-date">{t("fields.endDate")}</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded-lg"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dpd-target">{t("fields.dpdTarget")}</Label>
              <Input
                id="dpd-target"
                type="number"
                min={0}
                value={dpdTarget}
                onChange={(e) => setDpdTarget(e.target.value)}
                className="h-9 rounded-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("fields.dpdPeriod")}</Label>
              <Select
                items={[
                  { value: "none", label: "—" },
                  ...INCENTIVE_PERIODS.map((p) => ({
                    value: p,
                    label: t(`period.${p}`),
                  })),
                ]}
                value={dpdPeriod || "none"}
                onValueChange={(v) =>
                  setDpdPeriod(
                    v === "daily" || v === "weekly" || v === "monthly" ? v : "",
                  )
                }
              >
                <SelectTrigger className="h-9 w-full cursor-pointer rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" label="—">
                    —
                  </SelectItem>
                  {INCENTIVE_PERIODS.map((p) => (
                    <SelectItem key={p} value={p} label={t(`period.${p}`)}>
                      {t(`period.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
        </div>
        <AppModalFooter title={title} subtitle={t("fields.ruleName")}>
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
