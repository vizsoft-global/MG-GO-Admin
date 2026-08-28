"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  Check,
  Gauge,
  ListChecks,
  Loader2,
  Plus,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AppFormSection, AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { Link } from "@/i18n/navigation";
import {
  addDays,
  computeComponentBlend,
  computeOverallScore,
  kuwaitToday,
} from "./performance-formulas";
import {
  useDeletePerformanceRatingCriterion,
  useDriverPerformanceList,
  usePerformanceComponents,
  usePerformanceRatingTeams,
  usePerformanceScoreWeights,
  useRatingEligibleStaff,
  useSavePerformanceRatingCriterion,
  useSetPerformanceTeamMember,
  useUpdatePerformanceComponents,
  useUpdatePerformanceScoreWeights,
} from "./use-performance";
import type {
  PerformanceComponent,
  PerformanceCriterionConfig,
  PerformanceRatingTeamConfig,
} from "./performance-types";

/** A field whose value is a non-negative weight. */
function WeightField({
  id,
  label,
  hint,
  value,
  onChange,
  step = "0.1",
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        step={step}
        className="h-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? (
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function WeightsSection() {
  const t = useTranslations("pages.performance.settings");
  const { data: weights, isLoading } = usePerformanceScoreWeights();
  const { mutateAsync: save } = useUpdatePerformanceScoreWeights();
  const [pending, startTransition] = useTransition();

  const [delivery, setDelivery] = useState("1");
  const [utilization, setUtilization] = useState("1");
  const [compliance, setCompliance] = useState("1");
  const [manual, setManual] = useState("0");
  const [penalty, setPenalty] = useState("5");

  useEffect(() => {
    if (!weights) return;
    setDelivery(String(weights.delivery));
    setUtilization(String(weights.utilization));
    setCompliance(String(weights.compliance));
    setManual(String(weights.manual));
    setPenalty(String(weights.exception_penalty));
  }, [weights]);

  const parsed = useMemo(
    () => ({
      delivery: Number(delivery),
      utilization: Number(utilization),
      compliance: Number(compliance),
      manual: Number(manual),
      exception_penalty: Number(penalty),
    }),
    [delivery, utilization, compliance, manual, penalty],
  );

  const autoSum = parsed.delivery + parsed.utilization + parsed.compliance;
  const manualShare =
    autoSum + parsed.manual > 0
      ? Math.round((parsed.manual / (autoSum + parsed.manual)) * 100)
      : 0;

  // Same inputs, once with a rating and once without, so the operator can see
  // what the manual weight actually does before saving it.
  const previewRated = computeOverallScore(0.9, 0.9, 90, parsed, 50);
  const previewUnrated = computeOverallScore(0.9, 0.9, 90, parsed, null);

  function handleSave() {
    startTransition(async () => {
      const result = await save(parsed);
      if (!result.success) {
        toast.error(result.error ?? t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
    });
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <AppFormSection title={t("weightsTitle")} description={t("weightsHint")}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <WeightField
          id="w-delivery"
          label={t("weightDelivery")}
          value={delivery}
          onChange={setDelivery}
        />
        <WeightField
          id="w-utilization"
          label={t("weightUtilization")}
          value={utilization}
          onChange={setUtilization}
        />
        <WeightField
          id="w-compliance"
          label={t("weightCompliance")}
          value={compliance}
          onChange={setCompliance}
        />
        <WeightField
          id="w-manual"
          label={t("weightManual")}
          hint={t("weightManualHint", { share: manualShare })}
          value={manual}
          onChange={setManual}
        />
        <WeightField
          id="w-penalty"
          label={t("exceptionPenalty")}
          hint={t("exceptionPenaltyHint")}
          value={penalty}
          onChange={setPenalty}
          step="1"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
        <Gauge className="size-3.5 text-primary" />
        <p className="text-[11px] text-muted-foreground">
          {t("preview", { rated: previewRated, unrated: previewUnrated })}
        </p>
      </div>

      <div className="mt-4">
        <Button type="button" className="h-9" onClick={handleSave} disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </AppFormSection>
  );
}

/** Drivers sampled for the preview. Enough to be representative, small enough
 *  that a settings page does not pull the whole fleet on every keystroke. */
const PREVIEW_SAMPLE = 200;
const PREVIEW_DAYS = 30;

function averageBlend(
  rows: { component_scores: Record<string, number | undefined> }[],
  components: PerformanceComponent[],
): number | null {
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    const blend = computeComponentBlend(row.component_scores, components);
    if (blend == null) continue;
    sum += blend;
    count += 1;
  }
  if (count === 0) return null;
  return Math.round((sum / count) * 10) / 10;
}

function ComponentsSection() {
  const t = useTranslations("pages.performance.settings");
  const locale = useLocale();
  const { data, isLoading } = usePerformanceComponents();
  const { mutateAsync: save } = useUpdatePerformanceComponents();
  const [pending, startTransition] = useTransition();

  const [weights, setWeights] = useState<Record<string, string>>({});
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [sla, setSla] = useState("45");
  const [speedAllowance, setSpeedAllowance] = useState("2");
  const [conductAllowance, setConductAllowance] = useState("0.25");

  useEffect(() => {
    if (!data) return;
    setWeights(
      Object.fromEntries(data.components.map((c) => [c.key, String(c.weight)])),
    );
    setActive(
      Object.fromEntries(data.components.map((c) => [c.key, c.is_active])),
    );
    setSla(String(data.settings.delivery_ontime_minutes));
    setSpeedAllowance(String(data.settings.speed_allowance_per_day));
    setConductAllowance(String(data.settings.conduct_allowance_per_day));
  }, [data]);

  const today = kuwaitToday();
  // The preview is measured on the real fleet rather than on an invented driver:
  // a what-if an operator cannot recognise is one they will not trust.
  const { data: sample, isLoading: sampleLoading } = useDriverPerformanceList({
    fromDate: addDays(today, -(PREVIEW_DAYS - 1)),
    toDate: today,
    page: 0,
    pageSize: PREVIEW_SAMPLE,
    sort: "overall_desc",
  });

  /** The components as edited but not yet saved, for the third preview number. */
  const editedComponents = useMemo<PerformanceComponent[]>(
    () =>
      (data?.components ?? []).map((c) => ({
        ...c,
        weight: Number.isFinite(Number(weights[c.key]))
          ? Math.max(0, Number(weights[c.key]))
          : c.weight,
        is_active: active[c.key] ?? c.is_active,
      })),
    [data?.components, weights, active],
  );

  const rows = sample?.rows ?? [];
  const savedAverage = useMemo(
    () =>
      rows.length === 0
        ? null
        : Math.round(
            (rows.reduce(
              (acc, r) => acc + (r.compliance_score ?? 0),
              0,
            ) /
              Math.max(1, rows.filter((r) => r.compliance_score != null).length)) *
              10,
          ) / 10,
    [rows],
  );
  const legacyAverage = useMemo(
    () =>
      rows.length === 0
        ? null
        : Math.round(
            (rows.reduce(
              (acc, r) => acc + (r.legacy_compliance_score ?? 0),
              0,
            ) /
              Math.max(
                1,
                rows.filter((r) => r.legacy_compliance_score != null).length,
              )) *
              10,
          ) / 10,
    [rows],
  );
  const editedAverage = useMemo(
    () => averageBlend(rows, editedComponents),
    [rows, editedComponents],
  );

  function handleSave() {
    startTransition(async () => {
      const result = await save({
        components: (data?.components ?? []).map((c) => ({
          key: c.key,
          weight: Math.max(0, Number(weights[c.key] ?? c.weight)),
          is_active: active[c.key] ?? c.is_active,
        })),
        settings: {
          delivery_ontime_minutes: Math.max(1, Number(sla) || 45),
          speed_allowance_per_day: Math.max(0, Number(speedAllowance) || 0),
          conduct_allowance_per_day: Math.max(0, Number(conductAllowance) || 0),
        },
      });
      if (!result.success) {
        toast.error(result.error ?? t("componentsSaveFailed"));
        return;
      }
      toast.success(t("componentsSaved"));
    });
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <AppFormSection
      title={t("componentsTitle")}
      description={t("componentsHint")}
    >
      <div className="grid gap-3 lg:grid-cols-2 lg:items-stretch">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <ul className="space-y-2">
            {(data?.components ?? []).map((c) => {
              const label = locale.startsWith("ar") ? c.label_ar : c.label_en;
              const on = active[c.key] ?? c.is_active;
              return (
                <li key={c.key} className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setActive((prev) => ({ ...prev, [c.key]: !on }))
                    }
                    className={`inline-flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2.5 text-start text-xs transition-colors ${
                      on
                        ? "border-emerald-500 bg-emerald-100 font-semibold text-emerald-900 ring-1 ring-emerald-400/50"
                        : "border-border bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    {on ? (
                      <Check className="size-3.5 shrink-0" />
                    ) : (
                      <Gauge className="size-3.5 shrink-0 opacity-60" />
                    )}
                    <span className="truncate">{label}</span>
                  </button>
                  <Input
                    type="number"
                    min={0}
                    step="0.1"
                    aria-label={label}
                    className="h-9 w-20 shrink-0"
                    value={weights[c.key] ?? String(c.weight)}
                    disabled={!on}
                    onChange={(e) =>
                      setWeights((prev) => ({
                        ...prev,
                        [c.key]: e.target.value,
                      }))
                    }
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[10px] text-muted-foreground">
            {t("componentsDropNote")}
          </p>
        </div>

        <div className="flex h-full flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <WeightField
              id="c-sla"
              label={t("slaMinutes")}
              hint={t("slaMinutesHint")}
              value={sla}
              onChange={setSla}
              step="1"
            />
            <WeightField
              id="c-speed-allowance"
              label={t("speedAllowance")}
              hint={t("speedAllowanceHint")}
              value={speedAllowance}
              onChange={setSpeedAllowance}
              step="0.5"
            />
            <WeightField
              id="c-conduct-allowance"
              label={t("conductAllowance")}
              hint={t("conductAllowanceHint")}
              value={conductAllowance}
              onChange={setConductAllowance}
              step="0.05"
            />
          </div>

          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <p className="text-[11px] font-medium">
              {t("componentsPreviewTitle", {
                days: PREVIEW_DAYS,
                drivers: rows.length,
              })}
            </p>
            {sampleLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-border bg-card p-2">
                  <p className="text-[10px] text-muted-foreground">
                    {t("previewLegacy")}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {legacyAverage ?? "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-2">
                  <p className="text-[10px] text-muted-foreground">
                    {t("previewSaved")}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {savedAverage ?? "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-2">
                  <p className="text-[10px] text-primary">
                    {t("previewEdited")}
                  </p>
                  <p className="text-lg font-semibold tabular-nums text-primary">
                    {editedAverage ?? "—"}
                  </p>
                </div>
              </div>
            )}
            <p className="mt-2 text-[10px] text-muted-foreground">
              {t("componentsPreviewNote")}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Button
          type="button"
          className="h-9"
          onClick={handleSave}
          disabled={pending}
        >
          {pending ? t("saving") : t("componentsSave")}
        </Button>
      </div>
    </AppFormSection>
  );
}

function TeamsSection() {
  const t = useTranslations("pages.performance.settings");
  const locale = useLocale();
  const { data: teams, isLoading } = usePerformanceRatingTeams();
  const { data: staff } = useRatingEligibleStaff();
  const { mutateAsync: setMember } = useSetPerformanceTeamMember();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});

  const staffItems = useMemo(
    () =>
      (staff ?? []).map((s) => ({
        value: s.id,
        label: s.full_name,
        hint: s.email ?? undefined,
        keywords: [s.full_name, s.email ?? ""],
      })),
    [staff],
  );

  async function change(teamKey: string, profileId: string, member: boolean) {
    setPendingKey(`${teamKey}:${profileId}`);
    try {
      const result = await setMember({ teamKey, profileId, member });
      if (!result.success) {
        toast.error(
          result.error === "not_authorized"
            ? t("teamsNotAuthorized")
            : (result.error ?? t("teamsSaveFailed")),
        );
        return;
      }
      toast.success(member ? t("memberAdded") : t("memberRemoved"));
      if (member) setPicked((prev) => ({ ...prev, [teamKey]: "" }));
    } finally {
      setPendingKey(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <AppFormSection title={t("teamsTitle")} description={t("teamsHint")}>
      <div className="grid gap-3 lg:grid-cols-3 lg:items-stretch">
        {(teams ?? []).map((team) => {
          const label = locale.startsWith("ar") ? team.label_ar : team.label_en;
          const selected = picked[team.key] ?? "";
          const alreadyMember = team.members.some(
            (m) => m.profile_id === selected,
          );
          return (
            <div
              key={team.key}
              className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Star className="size-3.5 text-amber-500" />
                  <p className="text-sm font-semibold">{label}</p>
                </div>
                <span className="rounded-md border border-primary/20 bg-primary/10 px-1.5 text-[10px] font-semibold tabular-nums text-primary">
                  {t("teamWeight", { weight: team.weight })}
                </span>
              </div>

              <ul className="mt-3 min-h-0 flex-1 space-y-1">
                {team.members.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-border px-2 py-3 text-center text-[10px] text-muted-foreground">
                    {t("noMembers")}
                  </li>
                ) : (
                  team.members.map((m) => (
                    <li
                      key={m.profile_id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">
                          {m.full_name}
                        </p>
                        {m.email ? (
                          <p className="truncate text-[10px] text-muted-foreground">
                            {m.email}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-destructive hover:bg-destructive/10"
                        disabled={pendingKey === `${team.key}:${m.profile_id}`}
                        onClick={() => void change(team.key, m.profile_id, false)}
                        aria-label={t("removeMember")}
                        title={t("removeMember")}
                      >
                        {pendingKey === `${team.key}:${m.profile_id}` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    </li>
                  ))
                )}
              </ul>

              <div className="mt-3 flex items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label className="flex items-center gap-1 text-[10px]">
                    <Users className="size-3" />
                    {t("addMember")}
                  </Label>
                  <SearchSelect
                    items={staffItems}
                    value={selected}
                    onChange={(v) =>
                      setPicked((prev) => ({ ...prev, [team.key]: v ?? "" }))
                    }
                    placeholder={t("staffPlaceholder")}
                    searchPlaceholder={t("staffSearch")}
                    recentsKey="performance-rating-team-members"
                    className="h-9"
                  />
                </div>
                <Button
                  type="button"
                  className="h-9 shrink-0"
                  disabled={
                    selected === "" ||
                    alreadyMember ||
                    pendingKey === `${team.key}:${selected}`
                  }
                  onClick={() => void change(team.key, selected, true)}
                >
                  <Plus className="size-3.5" />
                  {t("add")}
                </Button>
              </div>
              {alreadyMember ? (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {t("alreadyMember")}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </AppFormSection>
  );
}

/**
 * What one team judges on. Weights are within the team, never across it — a
 * criterion weight of 2 means it counts double against its siblings, not that
 * the team outvotes another team.
 */
function CriteriaCard({ team }: { team: PerformanceRatingTeamConfig }) {
  const t = useTranslations("pages.performance.settings");
  const locale = useLocale();
  const isArabic = locale.startsWith("ar");
  const label = isArabic ? team.label_ar : team.label_en;

  const { mutateAsync: save } = useSavePerformanceRatingCriterion();
  const { mutateAsync: remove } = useDeletePerformanceRatingCriterion();

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftWeight, setDraftWeight] = useState("1");

  function criterionError(error?: string) {
    if (error === "not_authorized") return t("teamsNotAuthorized");
    if (error === "criterion_in_use") return t("criterionInUse");
    if (error === "duplicate_key") return t("criterionDuplicate");
    return error ?? t("teamsSaveFailed");
  }

  async function persist(
    criterion: PerformanceCriterionConfig,
    patch: Partial<Pick<PerformanceCriterionConfig, "weight" | "is_active">>,
  ) {
    setPendingId(criterion.id);
    try {
      const result = await save({
        id: criterion.id,
        teamKey: team.key,
        labelEn: criterion.label_en,
        labelAr: criterion.label_ar,
        weight: patch.weight ?? criterion.weight,
        sortOrder: criterion.sort_order,
        isActive: patch.is_active ?? criterion.is_active,
      });
      if (!result.success) {
        toast.error(criterionError(result.error));
        return;
      }
      toast.success(t("criterionSaved"));
    } finally {
      setPendingId(null);
    }
  }

  async function add() {
    const labelText = draftLabel.trim();
    if (labelText === "") return;
    setPendingId("new");
    try {
      const result = await save({
        teamKey: team.key,
        labelEn: labelText,
        // One label until a translator supplies the other. An empty Arabic
        // label would render as a blank star row rather than as a gap to fill.
        labelAr: labelText,
        weight: Number(draftWeight) || 1,
        sortOrder: team.criteria.length,
        isActive: true,
      });
      if (!result.success) {
        toast.error(criterionError(result.error));
        return;
      }
      setDraftLabel("");
      setDraftWeight("1");
      toast.success(t("criterionAdded"));
    } finally {
      setPendingId(null);
    }
  }

  async function drop(criterion: PerformanceCriterionConfig) {
    setPendingId(criterion.id);
    try {
      const result = await remove(criterion.id);
      if (!result.success) {
        toast.error(criterionError(result.error));
        return;
      }
      toast.success(t("criterionDeleted"));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <ListChecks className="size-3.5 text-primary" />
        <p className="text-sm font-semibold">{label}</p>
      </div>

      <ul className="mt-3 min-h-0 flex-1 space-y-1">
        {team.criteria.length === 0 ? (
          <li className="rounded-lg border border-dashed border-border px-2 py-3 text-center text-[10px] text-muted-foreground">
            {t("noCriteria")}
          </li>
        ) : (
          team.criteria.map((criterion) => (
            <li
              key={criterion.id}
              className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  {isArabic ? criterion.label_ar : criterion.label_en}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {t("criterionRatings", { count: criterion.rating_count })}
                </p>
              </div>
              <Input
                type="number"
                min="0"
                step="0.1"
                className="h-8 w-16 shrink-0 text-xs"
                defaultValue={String(criterion.weight)}
                disabled={pendingId === criterion.id}
                aria-label={t("criterionWeight")}
                onBlur={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next) || next === criterion.weight)
                    return;
                  void persist(criterion, { weight: next });
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 px-2 text-[10px]"
                disabled={pendingId === criterion.id}
                onClick={() =>
                  void persist(criterion, { is_active: !criterion.is_active })
                }
              >
                {criterion.is_active ? t("criterionOn") : t("criterionOff")}
              </Button>
              {/*
                Delete is only offered when nothing was filed against it. The
                server refuses otherwise, and offering a button that reports a
                refusal is worse than not offering it.
              */}
              {criterion.rating_count === 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-destructive hover:bg-destructive/10"
                  disabled={pendingId === criterion.id}
                  onClick={() => void drop(criterion)}
                  aria-label={t("removeCriterion")}
                  title={t("removeCriterion")}
                >
                  {pendingId === criterion.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              ) : null}
            </li>
          ))
        )}
      </ul>

      <div className="mt-3 flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Label className="text-[10px]">{t("addCriterion")}</Label>
          <Input
            className="h-9 text-xs"
            value={draftLabel}
            maxLength={60}
            placeholder={t("criterionPlaceholder")}
            onChange={(e) => setDraftLabel(e.target.value)}
          />
        </div>
        <div className="w-16 shrink-0 space-y-1">
          <Label className="text-[10px]">{t("criterionWeight")}</Label>
          <Input
            type="number"
            min="0"
            step="0.1"
            className="h-9 text-xs"
            value={draftWeight}
            onChange={(e) => setDraftWeight(e.target.value)}
          />
        </div>
        <Button
          type="button"
          className="h-9 shrink-0"
          disabled={draftLabel.trim() === "" || pendingId === "new"}
          onClick={() => void add()}
        >
          <Plus className="size-3.5" />
          {t("add")}
        </Button>
      </div>
    </div>
  );
}

function CriteriaSection() {
  const t = useTranslations("pages.performance.settings");
  const { data: teams, isLoading } = usePerformanceRatingTeams();

  if (isLoading) return null;

  return (
    <AppFormSection title={t("criteriaTitle")} description={t("criteriaHint")}>
      <div className="grid gap-3 lg:grid-cols-3 lg:items-stretch">
        {(teams ?? []).map((team) => (
          <CriteriaCard key={team.key} team={team} />
        ))}
      </div>
    </AppFormSection>
  );
}

export function PerformanceSettingsPanel() {
  const t = useTranslations("pages.performance.settings");

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Link
            href="/performance"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm text-primary transition-colors hover:bg-primary/10"
          >
            <ArrowLeft className="size-3.5" />
            {t("back")}
          </Link>
        }
      />
      <WeightsSection />
      <ComponentsSection />
      <TeamsSection />
      <CriteriaSection />
    </AppPage>
  );
}
