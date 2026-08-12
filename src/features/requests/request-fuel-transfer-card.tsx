"use client";

import { AlertCircle, Banknote, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SegmentOption } from "@/components/app/toggle-chip";
import { FUEL_TRANSFER_TYPES } from "./types";
import type { FuelTransferType } from "./types";
import { useSetFuelTransferType } from "./use-requests";

const OPTION_ICONS: Record<FuelTransferType, typeof Banknote> = {
  cash: Banknote,
  salary: Wallet,
};

/**
 * Figma 4149:27167 shows "In cash" pre-selected. It is left unselected here instead: a payout
 * method nobody chose would read as a decision somebody made.
 */
export function RequestFuelTransferCard({
  requestId,
  value,
  editable,
}: {
  requestId: string;
  value: FuelTransferType | null;
  editable: boolean;
}) {
  const t = useTranslations("pages.requests.detail.fuelTransfer");
  const save = useSetFuelTransferType(requestId);

  const choose = async (next: FuelTransferType) => {
    const result = await save.mutateAsync(next === value ? null : next);
    if (!result.ok) {
      toast.error(result.error ?? t("failed"));
      return;
    }
    toast.success(t("saved"));
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold">{t("title")}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup">
        {FUEL_TRANSFER_TYPES.map((option) => {
          const Icon = OPTION_ICONS[option];
          return (
            <SegmentOption
              key={option}
              selected={value === option}
              disabled={!editable || save.isPending}
              onClick={() => void choose(option)}
            >
              <Icon className="h-3 w-3" />
              {t(`options.${option}` as "options.cash")}
            </SegmentOption>
          );
        })}
      </div>
      {value == null ? (
        <p className="mt-2 flex items-center gap-1.5 text-[10px] text-warning">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {t("notSet")}
        </p>
      ) : (
        <p className="mt-2 text-[10px] text-muted-foreground">{t("hint")}</p>
      )}
    </section>
  );
}
