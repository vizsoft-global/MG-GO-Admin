"use client";

import { useLocale, useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { selectOptionsFrom } from "@/lib/select-items";
import type { RestrictionReason } from "./driver-freeze";

export const OTHER_REASON_VALUE = "__other__";

export function resolveRestrictionReason(
  selectedValue: string,
  otherText: string,
  reasons: RestrictionReason[],
): string {
  if (selectedValue === OTHER_REASON_VALUE) return otherText.trim();
  const match = reasons.find((row) => row.id === selectedValue);
  return match?.label_en.trim() ?? selectedValue.trim();
}

export function RestrictionReasonSelect({
  reasons,
  selectedValue,
  otherText,
  onSelectedValueChange,
  onOtherTextChange,
  disabled,
  fieldId,
}: {
  reasons: RestrictionReason[];
  selectedValue: string;
  otherText: string;
  onSelectedValueChange: (value: string) => void;
  onOtherTextChange: (value: string) => void;
  disabled?: boolean;
  fieldId: string;
}) {
  const t = useTranslations("pages.driverDetail.block");
  const locale = useLocale();
  const labelFor = (row: RestrictionReason) =>
    locale === "ar" ? row.label_ar : row.label_en;

  const items = [
    ...selectOptionsFrom(reasons, (row) => row.id, (row) => labelFor(row)),
    { value: OTHER_REASON_VALUE, label: t("reasonOther") },
  ];

  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>{t("reasonPick")}</Label>
      <Select
        items={items}
        value={selectedValue || null}
        onValueChange={(next) => onSelectedValueChange(next ?? "")}
        disabled={disabled}
      >
        <SelectTrigger id={fieldId} className="h-9 w-full cursor-pointer rounded-lg bg-background">
          <SelectValue placeholder={t("reasonPickPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {reasons.map((row) => (
            <SelectItem key={row.id} value={row.id} label={labelFor(row)}>
              {labelFor(row)}
            </SelectItem>
          ))}
          <SelectItem value={OTHER_REASON_VALUE} label={t("reasonOther")}>
            {t("reasonOther")}
          </SelectItem>
        </SelectContent>
      </Select>
      {selectedValue === OTHER_REASON_VALUE ? (
        <Textarea
          value={otherText}
          onChange={(e) => onOtherTextChange(e.target.value)}
          placeholder={t("reasonPlaceholder")}
          rows={3}
          disabled={disabled}
          className="min-h-[72px] resize-none"
        />
      ) : null}
      <p className="text-[10px] text-muted-foreground">{t("reasonHint")}</p>
    </div>
  );
}
