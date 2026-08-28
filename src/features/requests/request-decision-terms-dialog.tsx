"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import type { RequestDecisionTerms } from "./types";

type Draft = {
  approved_amount: string;
  approved_tenure_months: string;
  deduction_start_date: string;
  penalty_amount: string;
  required_document: string;
};

const EMPTY_DRAFT: Draft = {
  approved_amount: "",
  approved_tenure_months: "",
  deduction_start_date: "",
  penalty_amount: "",
  required_document: "",
};

function toDraft(terms: RequestDecisionTerms | null): Draft {
  if (!terms) return EMPTY_DRAFT;
  return {
    approved_amount: terms.approved_amount != null ? String(terms.approved_amount) : "",
    approved_tenure_months:
      terms.approved_tenure_months != null ? String(terms.approved_tenure_months) : "",
    deduction_start_date: terms.deduction_start_date ?? "",
    penalty_amount: terms.penalty_amount != null ? String(terms.penalty_amount) : "",
    required_document: terms.required_document ?? "",
  };
}

function toTerms(draft: Draft, requestType: string): RequestDecisionTerms {
  const number = (value: string) => {
    const parsed = Number(value.trim());
    return value.trim() !== "" && Number.isFinite(parsed) ? parsed : null;
  };

  if (requestType === "loan") {
    return {
      approved_amount: number(draft.approved_amount),
      approved_tenure_months: number(draft.approved_tenure_months),
      deduction_start_date: draft.deduction_start_date || null,
    };
  }
  if (requestType === "asset") {
    return { penalty_amount: number(draft.penalty_amount) };
  }
  return { required_document: draft.required_document.trim() || null };
}

export function RequestDecisionTermsDialog({
  open,
  onOpenChange,
  requestType,
  requestCode,
  initialTerms,
  mode,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestType: string;
  requestCode: string;
  initialTerms: RequestDecisionTerms | null;
  mode: "approve" | "edit";
  submitting: boolean;
  onSubmit: (terms: RequestDecisionTerms) => void;
}) {
  const t = useTranslations("pages.requests.detail.terms");
  const [draft, setDraft] = useState<Draft>(() => toDraft(initialTerms));

  useEffect(() => {
    if (!open) return;
    const next = toDraft(initialTerms);
    if (requestType === "loan" && !next.deduction_start_date) {
      next.deduction_start_date = kuwaitTodayYmd();
    }
    setDraft(next);
  }, [open, initialTerms, requestType]);

  const loanTermsIncomplete =
    requestType === "loan" && !draft.deduction_start_date;

  const set = (key: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(560px,96vw)] overflow-visible pt-4"
        showCloseButton
        closeOutside
      >
        <div className="grid gap-3 px-5 sm:grid-cols-2">
          {requestType === "loan" ? (
            <>
              <div className="space-y-1">
                <Label>{t("approvedAmount")}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  className="h-9"
                  value={draft.approved_amount}
                  onChange={(e) => set("approved_amount")(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t("tenureMonths")}</Label>
                <Input
                  type="number"
                  min={1}
                  className="h-9"
                  value={draft.approved_tenure_months}
                  onChange={(e) => set("approved_tenure_months")(e.target.value)}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>
                  {t("deductionStart")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="date"
                  className="h-9"
                  value={draft.deduction_start_date}
                  onChange={(e) => set("deduction_start_date")(e.target.value)}
                />
              </div>
            </>
          ) : null}

          {requestType === "asset" ? (
            <div className="space-y-1 sm:col-span-2">
              <Label>{t("penaltyAmount")}</Label>
              <Input
                type="number"
                min={0}
                step="0.001"
                className="h-9"
                value={draft.penalty_amount}
                onChange={(e) => set("penalty_amount")(e.target.value)}
              />
            </div>
          ) : null}

          {requestType === "sick_leave" ? (
            <div className="space-y-1 sm:col-span-2">
              <Label>{t("requiredDocument")}</Label>
              <Input
                className="h-9"
                value={draft.required_document}
                onChange={(e) => set("required_document")(e.target.value)}
                placeholder={t("requiredDocumentPlaceholder")}
              />
            </div>
          ) : null}

          <p className="text-[10px] text-muted-foreground sm:col-span-2">{t("hint")}</p>
        </div>

        <div className="px-2 pb-2 pt-3">
          <AppModalFooter
            title={mode === "approve" ? t("approveTitle") : t("editTitle")}
            subtitle={t("subtitle", { code: requestCode })}
          >
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              className="h-9"
              disabled={submitting || loanTermsIncomplete}
              onClick={() => onSubmit(toTerms(draft, requestType))}
            >
              {mode === "approve" ? t("approveSubmit") : t("editSubmit")}
            </Button>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
