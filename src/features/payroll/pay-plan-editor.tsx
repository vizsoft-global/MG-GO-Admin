"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Calculator, Loader2, Plus, RotateCcw, Save, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  computeDriverPay,
  DEFAULT_DRIVER_PAY_PLAN,
  money3,
  validatePayPlan,
  type DriverPayPlan,
  type PayInput,
  type PayPlanIssue,
  type PayVehicle,
} from "./driver-pay-plan";
import { loadDriverPayPlan, saveDriverPayPlan } from "./pay-plan-actions";

const SAVE_ERRORS = new Set<string>([
  "overlap",
  "gap",
  "threshold",
  "open_end",
  "rate",
  "ladder",
  "not_authorized",
  "not_configured",
  "save_failed",
]);

function planSignature(plan: DriverPayPlan): string {
  return JSON.stringify(plan);
}

function tenth(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Pay plan editor. Every number that decides a rider's month lives here, and the
 * preview below runs `computeDriverPay` — the same function the rider app uses —
 * so the operator sees the money the plan actually pays rather than a
 * re-description of it. The SOP reference case (470 orders / Bike / 2 rejected /
 * 0 invalid days = 166.500 KD) is what the default sample inputs show.
 */
export function PayPlanEditor({ canManage }: { canManage: boolean }) {
  const t = useTranslations("pages.payroll.payPlan");
  const locale = useLocale();

  const [plan, setPlan] = useState<DriverPayPlan | null>(null);
  const [saved, setSaved] = useState<DriverPayPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveFlash, setSaveFlash] = useState<"idle" | "saving" | "saved">("idle");

  const [sampleOrders, setSampleOrders] = useState("470");
  const [sampleVehicle, setSampleVehicle] = useState<PayVehicle>("bike");
  const [sampleRejected, setSampleRejected] = useState("2");
  const [sampleCancelled, setSampleCancelled] = useState("0");
  const [sampleInvalidDays, setSampleInvalidDays] = useState("0");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void loadDriverPayPlan().then((result) => {
      if (!alive) return;
      if ("plan" in result) {
        setPlan(result.plan);
        setSaved(result.plan);
        setLoadError(false);
      } else {
        setLoadError(true);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const patchPlan = useCallback((patch: Partial<DriverPayPlan>) => {
    setPlan((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  function patchThreshold(value: number) {
    setPlan((prev) => {
      if (!prev) return prev;
      const bands = prev.bands.map((band, index) =>
        index === 0 ? { ...band, from: value + 1 } : band,
      );
      return { ...prev, threshold: value, bands };
    });
  }

  function patchBand(index: number, patch: Partial<DriverPayPlan["bands"][number]>) {
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        bands: prev.bands.map((band, i) => (i === index ? { ...band, ...patch } : band)),
      };
    });
  }

  function addBand() {
    setPlan((prev) => {
      if (!prev) return prev;
      const last = prev.bands[prev.bands.length - 1];
      const from = last ? (last.to == null ? last.from + 1 : last.to + 1) : prev.threshold + 1;
      return { ...prev, bands: [...prev.bands, { from, to: null, rate: 0 }] };
    });
  }

  function removeBand(index: number) {
    setPlan((prev) => {
      if (!prev || prev.bands.length <= 1) return prev;
      return { ...prev, bands: prev.bands.filter((_, i) => i !== index) };
    });
  }

  function patchLadder(index: 0 | 1 | 2, value: number) {
    setPlan((prev) => {
      if (!prev) return prev;
      const ladder = [...prev.invalidLadder] as [number, number, number];
      ladder[index] = value;
      return { ...prev, invalidLadder: ladder };
    });
  }

  const dirty = useMemo(
    () => (plan && saved ? planSignature(plan) !== planSignature(saved) : false),
    [plan, saved],
  );

  const preview = useMemo(() => {
    if (!plan) return null;
    const input: PayInput = {
      orders: tenth(sampleOrders),
      vehicle: sampleVehicle,
      rejected: tenth(sampleRejected),
      cancelled: tenth(sampleCancelled),
      invalidDays: tenth(sampleInvalidDays),
    };
    return computeDriverPay(plan, input);
  }, [plan, sampleOrders, sampleVehicle, sampleRejected, sampleCancelled, sampleInvalidDays]);

  const blocked = useMemo(() => (plan ? validatePayPlan(plan) : null), [plan]);

  function persist() {
    if (!plan || !canManage) return;
    setSaveFlash("saving");
    void saveDriverPayPlan(locale, plan).then((result) => {
      if ("success" in result) {
        setPlan(result.plan);
        setSaved(result.plan);
        setSaveFlash("saved");
        toast.success(t("actions.saved"));
        window.setTimeout(() => setSaveFlash("idle"), 1200);
        return;
      }
      setSaveFlash("idle");
      toast.error(
        SAVE_ERRORS.has(result.error) ? t(`errors.${result.error}`) : t("errors.unknown"),
      );
    });
  }

  function resetToDefaults() {
    setPlan({ ...DEFAULT_DRIVER_PAY_PLAN, bands: DEFAULT_DRIVER_PAY_PLAN.bands.map((b) => ({ ...b })) });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-12 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="size-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  if (loadError || !plan || !preview) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground shadow-sm">
        {t("errors.load_failed")}
      </div>
    );
  }

  const issue: PayPlanIssue | null = blocked;
  const money = (value: number) => money3(value).toFixed(3);

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{t("title")}</h3>
            <p className="text-xs leading-4 text-muted-foreground">{t("hint")}</p>
          </div>
          {canManage ? (
            <div className="flex items-center gap-2">
              {saveFlash === "saving" ? (
                <span className="text-xs text-muted-foreground">{t("actions.saving")}</span>
              ) : saveFlash === "saved" ? (
                <span className="text-xs text-emerald-700">{t("actions.saved")}</span>
              ) : null}
              <Button type="button" variant="outline" className="h-9" onClick={resetToDefaults}>
                <RotateCcw className="size-3.5" />
                {t("actions.reset")}
              </Button>
              <Button
                type="button"
                className="h-9"
                disabled={!dirty || saveFlash === "saving" || issue != null}
                onClick={persist}
              >
                {saveFlash === "saving" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {t("actions.save")}
              </Button>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">{t("readOnly")}</span>
          )}
        </div>
        {issue ? (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900">
            <TriangleAlert className="size-3.5" />
            {t(`errors.${issue}`)}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-stretch">
        <div className="flex flex-col gap-2">
          <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div>
              <h3 className="text-sm font-semibold">{t("plan.title")}</h3>
              <p className="text-xs text-muted-foreground">{t("plan.hint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <NumberField
                id="pay-plan-base"
                label={t("plan.base")}
                value={plan.baseKwd}
                disabled={!canManage}
                onCommit={(v) => patchPlan({ baseKwd: v })}
              />
              <NumberField
                id="pay-plan-low-base"
                label={t("plan.lowBase")}
                value={plan.lowBaseKwd}
                disabled={!canManage}
                onCommit={(v) => patchPlan({ lowBaseKwd: v })}
              />
              <NumberField
                id="pay-plan-threshold"
                label={t("plan.threshold")}
                step="1"
                value={plan.threshold}
                disabled={!canManage}
                onCommit={patchThreshold}
              />
              <NumberField
                id="pay-plan-floor"
                label={t("plan.floor")}
                value={plan.floorKwd}
                disabled={!canManage}
                onCommit={(v) => patchPlan({ floorKwd: v })}
              />
            </div>
            <p className="text-xs leading-4 text-muted-foreground">
              {t("plan.thresholdHint")} · {t("plan.floorHint")}
            </p>
          </div>

          <div className="flex-1 space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{t("bands.title")}</h3>
                <p className="text-xs text-muted-foreground">{t("bands.hint")}</p>
              </div>
              {canManage ? (
                <Button type="button" variant="outline" className="h-9" onClick={addBand}>
                  <Plus className="size-3.5" />
                  {t("bands.add")}
                </Button>
              ) : null}
            </div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("bands.from")}</th>
                  <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("bands.to")}</th>
                  <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>{t("bands.rate")}</th>
                  <th className={cn(TABLE_HEAD_CLASS, "px-2 py-2 text-end")}> </th>
                </tr>
              </thead>
              <tbody>
                {plan.bands.map((band, index) => (
                  <tr key={`band-${index}`} className="border-b border-border/60">
                    <td className="px-2 py-2">
                      <Input
                        className="h-9 w-20"
                        inputMode="numeric"
                        value={band.from}
                        disabled={!canManage}
                        onChange={(e) => patchBand(index, { from: tenth(e.target.value) })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        className="h-9 w-20"
                        inputMode="numeric"
                        placeholder={t("bands.open")}
                        value={band.to ?? ""}
                        disabled={!canManage}
                        onChange={(e) =>
                          patchBand(index, { to: e.target.value === "" ? null : tenth(e.target.value) })
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        className="h-9 w-24"
                        inputMode="decimal"
                        value={band.rate}
                        disabled={!canManage}
                        onChange={(e) => patchBand(index, { rate: tenth(e.target.value) })}
                      />
                    </td>
                    <td className="px-2 py-2 text-end">
                      {canManage ? (
                        <button
                          type="button"
                          aria-label={t("bands.remove")}
                          className="inline-flex size-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-40"
                          disabled={plan.bands.length <= 1}
                          onClick={() => removeBand(index)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div>
              <h3 className="text-sm font-semibold">{t("penalties.title")}</h3>
              <p className="text-xs text-muted-foreground">{t("penalties.hint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                id="pay-plan-penalty-bike"
                label={t("penalties.bike")}
                value={plan.penaltyBike}
                disabled={!canManage}
                onCommit={(v) => patchPlan({ penaltyBike: v })}
              />
              <NumberField
                id="pay-plan-penalty-car"
                label={t("penalties.car")}
                value={plan.penaltyCar}
                disabled={!canManage}
                onCommit={(v) => patchPlan({ penaltyCar: v })}
              />
            </div>
            <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div>
                <h4 className="text-xs font-semibold">{t("ladder.title")}</h4>
                <span className="text-xs text-muted-foreground">{t("ladder.hint")}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <NumberField
                  id="pay-plan-ladder-1"
                  label={t("ladder.one")}
                  value={plan.invalidLadder[0]}
                  disabled={!canManage}
                  onCommit={(v) => patchLadder(0, v)}
                />
                <NumberField
                  id="pay-plan-ladder-2"
                  label={t("ladder.two")}
                  value={plan.invalidLadder[1]}
                  disabled={!canManage}
                  onCommit={(v) => patchLadder(1, v)}
                />
                <NumberField
                  id="pay-plan-ladder-3"
                  label={t("ladder.three")}
                  value={plan.invalidLadder[2]}
                  disabled={!canManage}
                  onCommit={(v) => patchLadder(2, v)}
                />
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-1.5">
              <Calculator className="size-3.5 text-primary" />
              <h3 className="text-sm font-semibold">{t("preview.title")}</h3>
            </div>
            <p className="text-xs leading-4 text-muted-foreground">{t("preview.hint")}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="pay-plan-sample-orders" className="text-xs">
                  {t("preview.orders")}
                </Label>
                <Input
                  id="pay-plan-sample-orders"
                  className="h-9 w-20"
                  inputMode="numeric"
                  value={sampleOrders}
                  onChange={(e) => setSampleOrders(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("preview.vehicle")}</Label>
                <Select
                  value={sampleVehicle}
                  onValueChange={(value) => setSampleVehicle((value ?? "bike") as PayVehicle)}
                >
                  <SelectTrigger className="h-9 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bike">{t("vehicle.bike")}</SelectItem>
                    <SelectItem value="car">{t("vehicle.car")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pay-plan-sample-rejected" className="text-xs">
                  {t("preview.rejected")}
                </Label>
                <Input
                  id="pay-plan-sample-rejected"
                  className="h-9 w-16"
                  inputMode="numeric"
                  value={sampleRejected}
                  onChange={(e) => setSampleRejected(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pay-plan-sample-cancelled" className="text-xs">
                  {t("preview.cancelled")}
                </Label>
                <Input
                  id="pay-plan-sample-cancelled"
                  className="h-9 w-16"
                  inputMode="numeric"
                  value={sampleCancelled}
                  onChange={(e) => setSampleCancelled(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pay-plan-sample-invalid" className="text-xs">
                  {t("preview.invalidDays")}
                </Label>
                <Input
                  id="pay-plan-sample-invalid"
                  className="h-9 w-16"
                  inputMode="numeric"
                  value={sampleInvalidDays}
                  onChange={(e) => setSampleInvalidDays(e.target.value)}
                />
              </div>
            </div>

            <div className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-emerald-400/50 bg-emerald-50 px-3 py-2 text-emerald-900">
              <span className="text-xs font-semibold uppercase tracking-wide">
                {t("preview.final")}
              </span>
              <span className="text-sm font-bold tabular-nums">{money(preview.finalPay)}</span>
              <span className="text-xs">{t("currency")}</span>
            </div>

            <table className="w-full border-collapse text-xs">
              <tbody>
                <tr className="border-b border-border/60">
                  <td className="px-1 py-1 text-muted-foreground">
                    {preview.lowPerformance ? t("plan.lowBase") : t("preview.base")}
                  </td>
                  <td className="px-1 py-1 text-end tabular-nums">{money(preview.base)}</td>
                </tr>
                {preview.bands.map((band, index) => (
                  <tr key={`preview-band-${index}`} className="border-b border-border/60">
                    <td className="px-1 py-1 text-muted-foreground">
                      {band.from} – {band.to == null ? t("bands.open") : band.to} ·{" "}
                      <span className="tabular-nums">
                        {band.orders} × {band.rate}
                      </span>
                    </td>
                    <td className="px-1 py-1 text-end tabular-nums">{money(band.amount)}</td>
                  </tr>
                ))}
                <tr className="border-b border-border/60 font-semibold">
                  <td className="px-1 py-1">{t("preview.gross")}</td>
                  <td className="px-1 py-1 text-end tabular-nums">{money(preview.gross)}</td>
                </tr>
                <tr className="border-b border-border/60">
                  <td className="px-1 py-1 text-muted-foreground">{t("preview.orderPenalty")}</td>
                  <td className="px-1 py-1 text-end tabular-nums text-destructive">
                    −{money(preview.orderPenalty)}
                  </td>
                </tr>
                <tr className="border-b border-border/60">
                  <td className="px-1 py-1 text-muted-foreground">{t("preview.invalidPenalty")}</td>
                  <td className="px-1 py-1 text-end tabular-nums text-destructive">
                    −{money(preview.invalidPenalty)}
                  </td>
                </tr>
                {preview.penaltyNotTaken > 0 ? (
                  <tr className="border-b border-border/60">
                    <td className="px-1 py-1 text-muted-foreground">{t("preview.notTaken")}</td>
                    <td className="px-1 py-1 text-end tabular-nums">{money(preview.penaltyNotTaken)}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            <div className="flex flex-wrap items-center gap-1.5">
              {preview.warnings.map((warning) => (
                <span
                  key={warning}
                  className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900"
                >
                  {t(`warnings.${warning}`)}
                </span>
              ))}
              {preview.ordersToNext != null && preview.nextBandFrom != null ? (
                <span className="text-xs text-muted-foreground">
                  {t("preview.ordersToNext", {
                    count: preview.ordersToNext,
                    from: preview.nextBandFrom,
                  })}
                </span>
              ) : null}
            </div>
            <p className="text-xs leading-4 text-muted-foreground">{t("preview.referenceHint")}</p>
          </div>
        </div>
      </div>
    </div>
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
      <Label htmlFor={id} className="text-xs">
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
