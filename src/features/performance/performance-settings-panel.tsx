"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  Gauge,
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
import { computeOverallScore } from "./performance-formulas";
import {
  usePerformanceRatingTeams,
  usePerformanceScoreWeights,
  useRatingEligibleStaff,
  useSetPerformanceTeamMember,
  useUpdatePerformanceScoreWeights,
} from "./use-performance";

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
      <TeamsSection />
    </AppPage>
  );
}
