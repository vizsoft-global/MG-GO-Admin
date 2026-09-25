"use client";

import { useMemo } from "react";
import { User } from "lucide-react";
import { SegmentOption } from "@/components/app/toggle-chip";
import { Input } from "@/components/ui/input";
import type { DriverProjectKey } from "@/features/fleet/fleet-labels";
import { ProjectKeyField } from "@/features/fleet/project-key-field";
import { countrySearchSelectItems } from "@/lib/geo/countries";
import type { DriverRiderCategory } from "../types";
import { companyMatchesCategory, selectableCompanies } from "../source-companies";
import { useSourceCompanies } from "../use-source-companies";
import { DriverAvatarUpload } from "../driver-avatar-upload";
import { CIVIL_ID_DIGIT_COUNT, restrictDigits } from "../driver-phone";
import { DriverPhoneField } from "./driver-phone-field";
import {
  FieldBlock,
  FieldError,
  FieldLabel,
  MetadataBadge,
  SectionHeading,
} from "./driver-form-primitives";
import { SearchableSelect } from "./searchable-select";

export function DriverFormIdentitySection({
  fullName,
  onFullNameChange,
  phone,
  onPhoneChange,
  civilId,
  onCivilIdChange,
  employeeId,
  onEmployeeIdChange,
  employeeIdRequired = true,
  nationality,
  onNationalityChange,
  riderCategory,
  onRiderCategoryChange,
  sourceCompany,
  onSourceCompanyChange,
  projectKey,
  onProjectKeyChange,
  driverCode,
  driverCodeHint,
  labels,
  riderCategoryLabels,
  projectLabels,
  placeholders,
  uploadLabel,
  removeLabel,
  avatarPreview,
  onAvatarSelect,
  onAvatarRemove,
  disabled,
  errors,
}: {
  fullName: string;
  onFullNameChange: (next: string) => void;
  phone: string;
  onPhoneChange: (next: string) => void;
  civilId: string;
  onCivilIdChange: (next: string) => void;
  employeeId: string;
  onEmployeeIdChange: (next: string) => void;
  employeeIdRequired?: boolean;
  nationality: string;
  onNationalityChange: (next: string) => void;
  riderCategory: DriverRiderCategory;
  onRiderCategoryChange: (next: DriverRiderCategory) => void;
  sourceCompany: string;
  onSourceCompanyChange: (next: string) => void;
  projectKey: DriverProjectKey | "";
  onProjectKeyChange: (next: DriverProjectKey | "") => void;
  driverCode: string;
  driverCodeHint: string;
  labels: {
    section: string;
    fullName: string;
    phone: string;
    civilId: string;
    employeeId: string;
    nationality: string;
    riderCategory: string;
    sourceCompany: string;
    project: string;
    driverCode: string;
  };
  riderCategoryLabels: {
    inHouse: string;
    outsourced: string;
  };
  projectLabels: {
    keeta: string;
    americana: string;
    unset: string;
  };
  placeholders: {
    fullName: string;
    civilId: string;
    employeeId?: string;
    employeeIdHelp?: string;
    nationality: string;
    searchNationality: string;
    sourceCompany?: string;
    searchSourceCompany?: string;
  };
  uploadLabel: string;
  removeLabel: string;
  avatarPreview: string | null;
  onAvatarSelect: (file: File | null) => void;
  onAvatarRemove: () => void;
  disabled?: boolean;
  errors: {
    fullName?: string;
    phone?: string;
    civilId?: string;
    employeeId?: string;
  };
}) {
  const countryItems = useMemo(() => countrySearchSelectItems(), []);
  const companies = useSourceCompanies();
  const systemCompany = companies.find((c) => c.is_system) ?? null;
  const companyItems = useMemo(
    () => [
      {
        value: "none",
        label: placeholders.sourceCompany ?? "—",
        keywords: ["none"],
      },
      ...selectableCompanies(riderCategory, companies, sourceCompany || null).map((c) => ({
        value: c.key,
        label: c.client_code ? `${c.name} · ${c.client_code}` : c.name,
        keywords: [c.key, c.name, c.client_code ?? ""],
      })),
    ],
    [placeholders.sourceCompany, riderCategory, companies, sourceCompany],
  );
  const changeCategory = (next: DriverRiderCategory) => {
    onRiderCategoryChange(next);
    if (sourceCompany && !companyMatchesCategory(next, sourceCompany, companies)) {
      onSourceCompanyChange("");
    }
  };

  return (
    <section className="space-y-2.5 rounded-lg border border-border bg-card p-4">
      <SectionHeading icon={User} accent="primary">
        {labels.section}
      </SectionHeading>
      <div className="grid grid-cols-[3rem_minmax(0,1fr)_11rem_12rem] items-end gap-2.5">
        <DriverAvatarUpload
          variant="badge"
          fullName={fullName}
          previewUrl={avatarPreview}
          uploadLabel={uploadLabel}
          removeLabel={removeLabel}
          hint=""
          onFileSelect={onAvatarSelect}
          onRemove={onAvatarRemove}
          disabled={disabled}
        />

        <FieldBlock>
          <FieldLabel htmlFor="driver-full-name" required>
            {labels.fullName}
          </FieldLabel>
          <Input
            id="driver-full-name"
            value={fullName}
            disabled={disabled}
            onChange={(event) => onFullNameChange(event.target.value)}
            className="h-9 rounded-md text-sm"
            placeholder={placeholders.fullName}
            aria-invalid={Boolean(errors.fullName)}
          />
          <FieldError message={errors.fullName} />
        </FieldBlock>

        <FieldBlock>
          <FieldLabel htmlFor="driver-phone">{labels.phone}</FieldLabel>
          <DriverPhoneField
            id="driver-phone"
            value={phone}
            disabled={disabled}
            ariaInvalid={Boolean(errors.phone)}
            onChange={onPhoneChange}
          />
          <FieldError message={errors.phone} />
        </FieldBlock>

        <FieldBlock>
          <FieldLabel htmlFor="driver-civil-id">{labels.civilId}</FieldLabel>
          <Input
            id="driver-civil-id"
            type="text"
            inputMode="numeric"
            maxLength={CIVIL_ID_DIGIT_COUNT}
            value={civilId}
            disabled={disabled}
            onChange={(event) =>
              onCivilIdChange(restrictDigits(event.target.value, CIVIL_ID_DIGIT_COUNT))
            }
            className="h-9 rounded-md font-mono text-sm tabular-nums"
            placeholder={placeholders.civilId}
            aria-invalid={Boolean(errors.civilId)}
          />
          <FieldError message={errors.civilId} />
        </FieldBlock>
      </div>

      <div className="grid grid-cols-[8.5rem_minmax(0,1fr)_11rem_10rem_8.5rem] items-end gap-2.5">
        <FieldBlock>
          <FieldLabel htmlFor="driver-employee-id">
            {labels.employeeId}
            {employeeIdRequired ? (
              <span className="text-destructive" aria-hidden>
                {" "}
                *
              </span>
            ) : null}
          </FieldLabel>
          <Input
            id="driver-employee-id"
            value={employeeId}
            disabled={disabled}
            maxLength={100}
            placeholder={placeholders.employeeId}
            onChange={(event) =>
              onEmployeeIdChange(event.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 100))
            }
            className="h-9 rounded-md font-mono text-sm"
            aria-invalid={Boolean(errors.employeeId)}
          />
          {placeholders.employeeIdHelp ? (
            <p className="text-[10px] leading-tight text-muted-foreground">
              {placeholders.employeeIdHelp}
            </p>
          ) : null}
          <FieldError message={errors.employeeId} />
        </FieldBlock>

        <FieldBlock>
          <FieldLabel htmlFor="driver-nationality">{labels.nationality}</FieldLabel>
          <SearchableSelect
            value={nationality}
            onValueChange={onNationalityChange}
            items={countryItems}
            placeholder={placeholders.nationality}
            searchPlaceholder={placeholders.searchNationality}
            recentsKey="driver-nationality"
            disabled={disabled}
          />
        </FieldBlock>

        <FieldBlock>
          <FieldLabel>{labels.riderCategory}</FieldLabel>
          <div role="radiogroup" className="grid grid-cols-2 gap-1.5">
            <SegmentOption
              selected={riderCategory === "in_house"}
              disabled={disabled}
              variant={riderCategory === "in_house" ? "success" : "default"}
              onClick={() => changeCategory("in_house")}
            >
              {riderCategoryLabels.inHouse}
            </SegmentOption>
            <SegmentOption
              selected={riderCategory === "outsourced"}
              disabled={disabled}
              variant={riderCategory === "outsourced" ? "success" : "default"}
              onClick={() => changeCategory("outsourced")}
            >
              {riderCategoryLabels.outsourced}
            </SegmentOption>
          </div>
        </FieldBlock>

        <FieldBlock>
          <FieldLabel htmlFor="driver-source-company">{labels.sourceCompany}</FieldLabel>
          {riderCategory === "in_house" ? (
            <Input
              id="driver-source-company"
              value={systemCompany?.name ?? ""}
              readOnly
              disabled
              className="h-9 rounded-md text-sm"
            />
          ) : (
            <SearchableSelect
              value={sourceCompany || "none"}
              onValueChange={(next) => onSourceCompanyChange(next === "none" ? "" : next)}
              items={companyItems}
              placeholder={placeholders.sourceCompany ?? "—"}
              searchPlaceholder={placeholders.searchSourceCompany ?? ""}
              recentsKey="driver-source-company"
              disabled={disabled}
            />
          )}
        </FieldBlock>

        <FieldBlock>
          <FieldLabel>{labels.driverCode}</FieldLabel>
          <MetadataBadge code={driverCode} label={driverCodeHint} />
        </FieldBlock>
      </div>

      <ProjectKeyField
        value={projectKey}
        onChange={onProjectKeyChange}
        label={labels.project}
        keetaLabel={projectLabels.keeta}
        americanaLabel={projectLabels.americana}
        unsetLabel={projectLabels.unset}
        disabled={disabled}
      />
    </section>
  );
}
