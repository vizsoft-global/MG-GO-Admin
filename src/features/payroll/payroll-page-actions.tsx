"use client";

import { useTranslations } from "next-intl";
import { Calculator, CalendarOff, Download, FilterX, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The five top actions every payroll page carries, in one component.
 *
 * Payroll hub and HR Payroll used to disagree: the hub had all five, HR had none
 * of them and its export lived inside the sheet. The actions are the same six
 * fields on every payroll page now, and the two pages that own their own table
 * register their export/clear through `payroll-actions-bridge`, so the button is
 * in one place and the work is still done by the table that knows how.
 */
export function PayrollPageActions({
  onPayPlan,
  onSponsorships,
  onOffStructure,
  onClearFilters,
  onExport,
  canUseSettings,
  canManage,
  canExport = true,
  exportDisabled = false,
  clearDisabled = false,
}: {
  onPayPlan: () => void;
  /** Sponsorships is a `/settings/*` page, so only a super admin may open it. */
  onSponsorships?: () => void;
  onOffStructure?: () => void;
  onClearFilters?: () => void;
  onExport?: () => void;
  canUseSettings?: boolean;
  canManage?: boolean;
  canExport?: boolean;
  exportDisabled?: boolean;
  clearDisabled?: boolean;
}) {
  const t = useTranslations("pages.payroll");
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" className="h-9" onClick={onPayPlan}>
        <Calculator className="size-3.5" />
        {t("payPlan.title")}
      </Button>
      {onSponsorships && canUseSettings ? (
        <Button type="button" variant="outline" className="h-9" onClick={onSponsorships}>
          <ScrollText className="size-3.5" />
          {t("sponsorship.title")}
        </Button>
      ) : null}
      {onOffStructure && canManage ? (
        <Button type="button" variant="outline" className="h-9" onClick={onOffStructure}>
          <CalendarOff className="size-3.5" />
          {t("offStructure.open")}
        </Button>
      ) : null}
      {onClearFilters ? (
        <Button type="button" variant="outline" className="h-9" onClick={onClearFilters} disabled={clearDisabled}>
          <FilterX className="size-3.5" />
          {t("clearFilters")}
        </Button>
      ) : null}
      {onExport && canExport ? (
        <Button type="button" className="h-9" onClick={onExport} disabled={exportDisabled}>
          <Download className="size-3.5" />
          {t("export")}
        </Button>
      ) : null}
    </div>
  );
}
