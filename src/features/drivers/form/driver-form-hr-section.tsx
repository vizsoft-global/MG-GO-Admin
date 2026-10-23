"use client";

import { useTranslations } from "next-intl";
import { Briefcase } from "lucide-react";
import { ToggleChip } from "@/components/app/toggle-chip";
import {
  catalogLabel,
  isNonOperationalOnly,
  type EmployeeCatalogRow,
} from "@/features/employees/employee-catalogs";
import { FieldBlock, FieldLabel, SectionHeading } from "./driver-form-primitives";
import { SearchableSelect } from "./searchable-select";

function toggleKey(current: string[], key: string): string[] {
  return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
}

export function DriverFormHrSection({
  locale,
  employeeStatusKey,
  onEmployeeStatusChange,
  sectionKeys,
  onSectionKeysChange,
  nationalityCategoryKeys,
  onNationalityCategoryKeysChange,
  statuses,
  sections,
  nationalityCategories,
  labels,
}: {
  locale: string;
  employeeStatusKey: string;
  onEmployeeStatusChange: (value: string) => void;
  sectionKeys: string[];
  onSectionKeysChange: (value: string[]) => void;
  nationalityCategoryKeys: string[];
  onNationalityCategoryKeysChange: (value: string[]) => void;
  statuses: readonly EmployeeCatalogRow[];
  sections: readonly EmployeeCatalogRow[];
  nationalityCategories: readonly EmployeeCatalogRow[];
  labels: {
    section: string;
    employeeStatus: string;
    sections: string;
    nationalityCategories: string;
    searchStatus: string;
  };
}) {
  const liveStatuses = statuses.filter((row) => row.is_active);
  const liveSections = sections.filter((row) => row.is_active);
  const liveNations = nationalityCategories.filter((row) => row.is_active);
  const tNew = useTranslations("pages.driverNew");
  const nonOperational = isNonOperationalOnly(sectionKeys, sections);

  return (
    <section className="space-y-2.5 rounded-lg border border-border bg-card p-4">
      <SectionHeading icon={Briefcase} accent="primary">
        {labels.section}
      </SectionHeading>
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
        <FieldBlock>
          <FieldLabel htmlFor="driver-employee-status">{labels.employeeStatus}</FieldLabel>
          <SearchableSelect
            value={employeeStatusKey}
            onValueChange={onEmployeeStatusChange}
            items={liveStatuses.map((row) => ({
              value: row.key,
              label: catalogLabel(row.key, liveStatuses, locale),
            }))}
            placeholder={labels.employeeStatus}
            searchPlaceholder={labels.searchStatus}
            recentsKey="driver-employee-status"
          />
        </FieldBlock>
        <FieldBlock>
          <FieldLabel>{labels.sections}</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {liveSections.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">—</p>
            ) : (
              liveSections.map((row) => (
                <ToggleChip
                  key={row.key}
                  selected={sectionKeys.includes(row.key)}
                  onClick={() => onSectionKeysChange(toggleKey(sectionKeys, row.key))}
                >
                  {catalogLabel(row.key, liveSections, locale)}
                </ToggleChip>
              ))
            )}
          </div>
          {nonOperational ? (
            <p className="text-[10px] leading-4 text-emerald-700">{tNew("nonOperationalHint")}</p>
          ) : null}
        </FieldBlock>
        <FieldBlock>
          <FieldLabel>{labels.nationalityCategories}</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {liveNations.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">—</p>
            ) : (
              liveNations.map((row) => (
                <ToggleChip
                  key={row.key}
                  selected={nationalityCategoryKeys.includes(row.key)}
                  onClick={() => onNationalityCategoryKeysChange(toggleKey(nationalityCategoryKeys, row.key))}
                >
                  {catalogLabel(row.key, liveNations, locale)}
                </ToggleChip>
              ))
            )}
          </div>
        </FieldBlock>
      </div>
    </section>
  );
}
