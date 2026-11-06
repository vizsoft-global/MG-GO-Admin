"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import { Briefcase } from "lucide-react";
import { FieldBlock, FieldLabel } from "@/features/drivers/form/driver-form-primitives";
import { SearchableSelect } from "@/features/drivers/form/searchable-select";
import {
  payrollClientItems,
  payrollClientRows,
  usePayrollClients,
} from "@/features/payroll/use-payroll-clients";

/**
 * The Client picker.
 *
 * One dropdown over the `payroll_clients` catalog, not a fixed set of buttons: a
 * client an operator adds in Employee Settings has to be assignable here without
 * a rebuild, and the old four-button group could only ever offer the three keys
 * the SOP named plus Unset. The value written is still `drivers.project_key`.
 */
export function ProjectKeyField({
  value,
  onChange,
  label,
  unsetLabel,
  hint,
  disabled,
  searchPlaceholder,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  /** Kept for callers that still pass the four card labels; the catalog is the list. */
  keetaLabel?: string;
  americanaLabel?: string;
  fiveGuysLabel?: string;
  unsetLabel: string;
  hint?: string;
  disabled?: boolean;
  searchPlaceholder?: string;
}) {
  const locale = useLocale();
  const query = usePayrollClients();
  const rows = payrollClientRows(query.data);
  const items = useMemo(() => {
    const base = payrollClientItems(rows, locale, value);
    // Unset first: choosing it is a real action, not an empty search result.
    return [{ value: "", label: unsetLabel }, ...base.filter((item) => item.value !== "")];
  }, [rows, locale, value, unsetLabel]);

  return (
    <FieldBlock>
      <FieldLabel icon={Briefcase}>{label}</FieldLabel>
      <SearchableSelect
        value={value}
        onValueChange={onChange}
        items={items}
        placeholder={unsetLabel}
        searchPlaceholder={searchPlaceholder ?? label}
        recentsKey="driver-client"
        disabled={disabled}
        className="h-9 w-full"
      />
      {hint ? <p className="text-xs leading-tight text-muted-foreground">{hint}</p> : null}
    </FieldBlock>
  );
}
