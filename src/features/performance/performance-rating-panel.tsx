"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Star, Trash2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useClearDriverPerformanceRating,
  useDriverPerformanceRatings,
  useSaveDriverPerformanceRating,
} from "./use-performance";
import { RATING_SCALE_MAX } from "./performance-types";
import type { PerformanceRatingTeamRow } from "./performance-types";

function RatingStars({
  value,
  disabled,
  onPick,
}: {
  value: number | null;
  disabled: boolean;
  onPick: (score: number) => void;
}) {
  const t = useTranslations("pages.performance.rating");
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: RATING_SCALE_MAX }, (_, i) => i + 1).map((score) => {
        const filled = value != null && score <= value;
        return (
          <button
            key={score}
            type="button"
            disabled={disabled}
            onClick={() => onPick(score)}
            aria-label={t("starLabel", { score })}
            title={t("starLabel", { score })}
            className="rounded p-0.5 transition-colors disabled:cursor-not-allowed enabled:hover:bg-primary/10"
          >
            <Star
              className={
                filled
                  ? "size-4 fill-amber-400 text-amber-500"
                  : "size-4 text-muted-foreground/50"
              }
            />
          </button>
        );
      })}
    </div>
  );
}

function TeamRatingRow({
  driverId,
  periodMonth,
  team,
}: {
  driverId: string;
  periodMonth: string;
  team: PerformanceRatingTeamRow;
}) {
  const t = useTranslations("pages.performance.rating");
  const locale = useLocale();
  const label = locale.startsWith("ar") ? team.label_ar : team.label_en;

  const [comment, setComment] = useState(team.comment ?? "");
  const save = useSaveDriverPerformanceRating();
  const clear = useClearDriverPerformanceRating();

  // The server row is the truth; a refetch after someone else rates must not be
  // overwritten by whatever is in this input.
  useEffect(() => {
    setComment(team.comment ?? "");
  }, [team.comment]);

  const busy = save.isPending || clear.isPending;

  async function submit(score: number, nextComment: string) {
    const result = await save.mutateAsync({
      driverId,
      teamKey: team.team_key,
      periodMonth,
      score,
      comment: nextComment.trim() === "" ? null : nextComment.trim(),
    });
    if (!result.success) {
      toast.error(t(ratingErrorKey(result.error)));
      return;
    }
    toast.success(t("saved", { team: label }));
  }

  async function remove() {
    const result = await clear.mutateAsync({
      driverId,
      teamKey: team.team_key,
      periodMonth,
    });
    if (!result.success) {
      toast.error(t(ratingErrorKey(result.error)));
      return;
    }
    toast.success(t("cleared", { team: label }));
  }

  return (
    <li className="space-y-1.5 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <UserCheck className="size-3.5 shrink-0 text-primary" />
          <span className="truncate text-xs font-medium">{label}</span>
          {team.score != null ? (
            <span className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-semibold tabular-nums text-emerald-800">
              {team.score}/{RATING_SCALE_MAX}
            </span>
          ) : (
            <span className="shrink-0 rounded-md border border-border bg-muted/30 px-1.5 text-[10px] text-muted-foreground">
              {t("notRated")}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {busy ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
          <RatingStars
            value={team.score}
            disabled={!team.can_edit || busy}
            onPick={(score) => void submit(score, comment)}
          />
          {team.can_edit && team.score != null ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-destructive hover:bg-destructive/10"
              disabled={busy}
              onClick={() => void remove()}
              aria-label={t("clear")}
              title={t("clear")}
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {team.can_edit ? (
        <div className="flex items-center gap-2">
          <Input
            className="h-8 text-xs"
            placeholder={t("commentPlaceholder")}
            value={comment}
            maxLength={280}
            disabled={busy}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => {
              if (team.score == null) return;
              if ((team.comment ?? "") === comment.trim()) return;
              void submit(team.score, comment);
            }}
          />
        </div>
      ) : team.comment ? (
        <p className="text-[10px] text-muted-foreground">{team.comment}</p>
      ) : null}

      <p className="text-[10px] text-muted-foreground">
        {team.rated_at
          ? t("ratedBy", {
              name: team.rated_by_name ?? "—",
              at: new Date(team.rated_at).toLocaleDateString(),
            })
          : team.can_edit
            ? t("yourTurn")
            : t("notYourTeam")}
      </p>
    </li>
  );
}

/** Maps an RPC error onto a locale key, defaulting to a generic failure. */
function ratingErrorKey(error?: string): string {
  switch (error) {
    case "not_team_member":
      return "errorNotTeamMember";
    case "not_authorized":
      return "errorNotAuthorized";
    case "future_period":
      return "errorFuturePeriod";
    case "invalid_score":
      return "errorInvalidScore";
    default:
      return "errorGeneric";
  }
}

export function PerformanceRatingPanel({
  driverId,
  periodMonth,
  rangeScore,
  rangeTeamCount,
}: {
  driverId: string;
  periodMonth: string;
  /**
   * The 0–100 manual score for the whole date range, which is what the score
   * column uses. Shown beside the month being edited because the two genuinely
   * differ whenever the range spans more than one month.
   */
  rangeScore?: number | null;
  rangeTeamCount?: number;
}) {
  const t = useTranslations("pages.performance.rating");
  const { data, isLoading } = useDriverPerformanceRatings(driverId, periodMonth);
  const teams = data?.teams ?? [];

  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Star className="size-3.5 text-amber-500" />
          <p className="text-xs font-medium">{t("title")}</p>
          {rangeScore != null ? (
            <span className="rounded-md border border-primary/20 bg-primary/10 px-1.5 text-[10px] font-semibold tabular-nums text-primary">
              {t("rangeScore", {
                score: rangeScore,
                teams: rangeTeamCount ?? 0,
              })}
            </span>
          ) : null}
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {t("period", { month: periodMonth.slice(0, 7) })}
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : teams.length === 0 ? (
        <p className="px-3 py-4 text-[10px] text-muted-foreground">
          {t("noTeams")}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {teams.map((team) => (
            <TeamRatingRow
              key={team.team_key}
              driverId={driverId}
              periodMonth={periodMonth}
              team={team}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
