"use client";

import { Landmark } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PAYMENT_CURRENCIES } from "@/lib/currencies";
import { catalogLabel, isNbkBank, type EmployeeCatalogRow } from "@/features/employees/employee-catalogs";
import type { DriverBankDetails } from "@/features/employees/bank-details";
import { FieldBlock, FieldError, FieldLabel, SectionHeading } from "./driver-form-primitives";
import { SearchableSelect } from "./searchable-select";

export function DriverFormBankCard({
  locale,
  value,
  onChange,
  banks,
  labels,
  errors,
}: {
  locale: string;
  value: DriverBankDetails;
  onChange: (next: DriverBankDetails) => void;
  banks: readonly EmployeeCatalogRow[];
  labels: {
    section: string;
    beneficiaryCivilId: string;
    bank: string;
    searchBank: string;
    accountNumber: string;
    iban: string;
    currency: string;
  };
  errors: {
    beneficiaryCivilId?: string;
    accountNumber?: string;
    iban?: string;
    bank?: string;
  };
}) {
  const liveBanks = banks.filter((row) => row.is_active);
  const nbk = isNbkBank(value.bank_code, liveBanks);

  return (
    <section className="space-y-2.5 rounded-lg border border-border bg-card p-4">
      <SectionHeading icon={Landmark} accent="primary">
        {labels.section}
      </SectionHeading>
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-4">
        <FieldBlock>
          <FieldLabel htmlFor="driver-bank-civil">{labels.beneficiaryCivilId}</FieldLabel>
          <Input
            id="driver-bank-civil"
            className="h-9 font-mono text-sm"
            maxLength={12}
            inputMode="numeric"
            value={value.beneficiary_civil_id ?? ""}
            onChange={(event) =>
              onChange({ ...value, beneficiary_civil_id: event.target.value.replace(/\D/g, "").slice(0, 12) || null })
            }
            aria-invalid={Boolean(errors.beneficiaryCivilId)}
          />
          <FieldError message={errors.beneficiaryCivilId} />
        </FieldBlock>
        <FieldBlock>
          <FieldLabel>{labels.bank}</FieldLabel>
          <SearchableSelect
            value={value.bank_code ?? ""}
            onValueChange={(next) => onChange({ ...value, bank_code: next || null, account_number: null, iban: null })}
            items={liveBanks.map((row) => ({
              value: row.key,
              label: catalogLabel(row.key, liveBanks, locale),
            }))}
            placeholder={labels.bank}
            searchPlaceholder={labels.searchBank}
            recentsKey="driver-bank-code"
          />
          <FieldError message={errors.bank} />
        </FieldBlock>
        {nbk ? (
          <FieldBlock>
            <FieldLabel htmlFor="driver-bank-account">{labels.accountNumber}</FieldLabel>
            <Input
              id="driver-bank-account"
              className="h-9 font-mono text-sm"
              maxLength={20}
              inputMode="numeric"
              value={value.account_number ?? ""}
              onChange={(event) =>
                onChange({ ...value, account_number: event.target.value.replace(/\D/g, "").slice(0, 20) || null })
              }
              aria-invalid={Boolean(errors.accountNumber)}
            />
            <FieldError message={errors.accountNumber} />
          </FieldBlock>
        ) : (
          <FieldBlock>
            <FieldLabel htmlFor="driver-bank-iban">{labels.iban}</FieldLabel>
            <Input
              id="driver-bank-iban"
              className="h-9 font-mono text-sm uppercase"
              maxLength={30}
              value={value.iban ?? ""}
              onChange={(event) =>
                onChange({
                  ...value,
                  iban: event.target.value.replace(/\s+/g, "").toUpperCase().slice(0, 30) || null,
                })
              }
              aria-invalid={Boolean(errors.iban)}
            />
            <FieldError message={errors.iban} />
          </FieldBlock>
        )}
        <FieldBlock>
          <FieldLabel>{labels.currency}</FieldLabel>
          <SearchableSelect
            value={value.currency}
            onValueChange={(next) => onChange({ ...value, currency: next as DriverBankDetails["currency"] })}
            items={PAYMENT_CURRENCIES.map((row) => ({
              value: row.code,
              label: `${row.code} · ${row.name}`,
            }))}
            placeholder={labels.currency}
            searchPlaceholder={labels.currency}
            recentsKey="driver-payment-currency"
          />
        </FieldBlock>
      </div>
    </section>
  );
}
