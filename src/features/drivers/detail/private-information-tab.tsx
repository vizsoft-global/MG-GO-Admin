"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PAYMENT_CURRENCIES, normalizePaymentCurrency } from "@/lib/currencies";
import { countrySearchSelectItems } from "@/lib/geo/countries";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import {
  catalogLabel,
  DEFAULT_BANK_CODES,
  DEFAULT_EMPLOYEE_SECTIONS,
  DEFAULT_EMPLOYEE_STATUSES,
  DEFAULT_HIRING_TYPES,
  DEFAULT_JOB_END_DESCRIPTIONS,
  DEFAULT_JOB_POSITIONS,
  DEFAULT_NATIONALITIES,
  DEFAULT_NATIONALITY_CATEGORIES,
  DEFAULT_PAYMENT_CURRENCIES,
  DEFAULT_SPONSORSHIPS,
  isNbkBank,
  type EmployeeCatalogRow,
} from "@/features/employees/employee-catalogs";
import { listedCompanies } from "../source-companies";
import { useSourceCompanies } from "../use-source-companies";
import {
  useBankCodes,
  useEmployeeSections,
  useEmployeeStatuses,
  useHiringTypes,
  useJobEndDescriptions,
  useJobPositions,
  useNationalities,
  useNationalityCategories,
  usePaymentCurrencies,
  useSponsorships,
} from "@/features/employees/use-employee-catalogs";
import { setDriverOffStructure } from "@/features/payroll/payroll-actions";
import {
  OFFS_STRUCTURE_DAYS,
} from "../driver-private-fields";
import { saveDriverPrivateInformation } from "../drivers-actions";
import {
  firstIdentityError,
  identityFieldErrors,
  type IdentityField,
} from "../driver-identity-required";
import { FieldBlock, FieldLabel } from "../form/driver-form-primitives";
import { SearchableSelect } from "../form/searchable-select";
import type { DriverDetailModel } from "../types";

type CardKey = "identity" | "status" | "bank" | "salary";

/** HTML `.ctrl`: 42px field, 8px radius, 9×12 padding. */
const FIELD = "h-[42px] min-h-[42px] w-full rounded-lg px-3 text-sm";

function catalogRows(
  loaded: readonly EmployeeCatalogRow[] | undefined,
  seeds: readonly EmployeeCatalogRow[],
): EmployeeCatalogRow[] {
  return loaded && loaded.length > 0 ? [...loaded] : [...seeds];
}

const GRID = "grid grid-cols-1 gap-x-5 gap-y-4 pt-[18px] sm:grid-cols-2 xl:grid-cols-4";
const W2 = "xl:col-span-2";
const LABEL = "text-sm font-semibold text-muted-foreground";

/** The input each mandatory identity field renders, for focus and jump actions. */
const IDENTITY_INPUT_ID: Record<IdentityField, string> = {
  civilId: "p-civil",
  phone: "p-phone",
  passport: "p-passport",
};

function catalogItems(rows: readonly EmployeeCatalogRow[], locale: string) {
  return rows
    .filter((row) => row.is_active && row.key)
    .map((row) => ({ value: row.key, label: catalogLabel(row.key, rows, locale) }));
}

function choiceItems(
  rows: readonly EmployeeCatalogRow[],
  locale: string,
  blank: string,
  current: readonly string[],
) {
  const items = catalogItems(rows, locale);
  for (const key of current) {
    if (key && key !== "none" && !items.some((item) => item.value === key)) {
      items.unshift({ value: key, label: catalogLabel(key, rows, locale) });
    }
  }
  return [{ value: "none", label: blank }, ...items];
}

function bankChoiceItems(
  rows: readonly EmployeeCatalogRow[],
  locale: string,
  blank: string,
  cashLabel: string,
  current: string,
) {
  const items = catalogItems(rows, locale).filter(
    (item) => item.value !== "cash" && item.value !== "none",
  );
  if (current && current !== "cash" && current !== "none" && !items.some((item) => item.value === current)) {
    items.unshift({ value: current, label: catalogLabel(current, rows, locale) });
  }
  return [
    { value: "none", label: blank },
    ...items,
    { value: "cash", label: cashLabel },
  ];
}

function AccordionCard({
  id,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  count: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-border bg-card">
      <button
        type="button"
        className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-6 py-[18px] text-start"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={onToggle}
      >
        <span className="min-w-0 flex-1 text-xs font-bold uppercase tracking-[0.06em] text-[#A73C24]">
          {title}
        </span>
        <span className="text-sm text-muted-foreground">{count}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div id={`${id}-panel`} className="border-t border-border px-6 pb-[22px] pt-1">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function buildForm(driver: DriverDetailModel) {
  const info = driver.private_info;
  const bank = driver.bank_details;
  return {
    fullName: driver.full_name ?? "",
    phone: driver.phone === "—" ? "" : (driver.phone ?? ""),
    civilId: driver.civil_id === "—" ? "" : (driver.civil_id ?? ""),
    passportNumber: driver.passport_number ?? "",
    nationality: driver.nationality ?? "",
    nationalityCategoryKeys: Array.isArray(driver.nationality_category_keys)
      ? driver.nationality_category_keys
      : [],
    riderCategory: driver.rider_category === "outsourced" ? "outsourced" : "in_house",
    sourceCompany: driver.source_company ?? "",
    sectionKeys: Array.isArray(driver.section_keys) ? driver.section_keys : [],
    sponsorshipKey: info.sponsorship_key ?? "",
    jobPosition: info.job_position ?? "",
    hiringType: info.hiring_type ?? "",
    employeeStatusKey: driver.employee_status_key ?? "",
    workStartDate: info.work_start_date ?? "",
    jobEndDate: info.job_end_date ?? "",
    jobEndDescription: info.job_end_description ?? "",
    residencyExpiryDate: info.residency_expiry_date ?? "",
    beneficiaryCivilId: bank?.beneficiary_civil_id ?? "",
    bankCode: bank?.bank_code ?? "",
    accountNumber: bank?.account_number ?? "",
    iban: bank?.iban ?? "",
    currency: normalizePaymentCurrency(bank?.currency ?? "KWD"),
    fixedSalary: info.fixed_salary != null ? String(info.fixed_salary) : "",
    workPermitSalary: info.work_permit_salary != null ? String(info.work_permit_salary) : "",
    lastIncrementDate: info.last_increment_date ?? "",
  };
}

export function PrivateInformationTab({
  driver,
  canManage,
  focusIdentityToken = 0,
}: {
  driver: DriverDetailModel;
  canManage: boolean;
  /**
   * Incremented by the page when an action (approve) refused because identity
   * fields are missing: the tab opens the Identity card, shows the red fields
   * and focuses the first blank.
   */
  focusIdentityToken?: number;
}) {
  const t = useTranslations("pages.driverDetail.profile");
  const tNew = useTranslations("pages.driverNew");
  const locale = useLocale();
  const router = useRouter();

  const statuses = useEmployeeStatuses();
  const sections = useEmployeeSections();
  const nationalityCategories = useNationalityCategories();
  const banks = useBankCodes();
  const sponsorships = useSponsorships();
  const companies = useSourceCompanies();
  const jobPositions = useJobPositions();
  const hiringTypes = useHiringTypes();
  const jobEndDescriptions = useJobEndDescriptions();
  const nationalities = useNationalities();
  const paymentCurrencies = usePaymentCurrencies();

  const readonly = !canManage || !driver.intake_id;
  const bank = driver.bank_details;

  const [form, setForm] = useState(() => buildForm(driver));
  /**
   * The beneficiary Civil ID mirrors the rider's until someone types their own.
   * Initialising from the stored pair means an existing override survives a
   * reload, and a record whose two IDs match starts synced again.
   */
  const [beneficiaryTouched, setBeneficiaryTouched] = useState(
    Boolean(
      driver.bank_details?.beneficiary_civil_id &&
        driver.bank_details.beneficiary_civil_id !== driver.civil_id,
    ),
  );
  const [showIdentityErrors, setShowIdentityErrors] = useState(false);
  /**
   * The Position picker reads the catalog, so a position added in Operations Hub
   * appears here without a rebuild. The compiled six are the fallback while the
   * catalog read is in flight.
   */
  const jobPositionOptions = (() => {
    const rows = catalogRows(jobPositions.data, DEFAULT_JOB_POSITIONS);
    const options = rows
      .filter((row) => row.is_active)
      .map((row) => ({
        value: row.key,
        label: locale.startsWith("ar") ? row.label_ar || row.label_en : row.label_en || row.key,
      }));
    // A rider stored on a position the catalog no longer lists keeps that value.
    if (form.jobPosition && !options.some((option) => option.value === form.jobPosition)) {
      options.push({ value: form.jobPosition, label: form.jobPosition });
    }
    return options;
  })();
  const dirty = JSON.stringify(form) !== JSON.stringify(buildForm(driver));
  const [offsDays, setOffsDays] = useState<string>(
    driver.offs_structure_days != null ? String(driver.offs_structure_days) : "none",
  );
  const [open, setOpen] = useState<Record<CardKey, boolean>>({
    identity: false,
    status: false,
    bank: false,
    salary: false,
  });
  const [saving, setSaving] = useState(false);
  const [savingOffs, setSavingOffs] = useState(false);

  const statusRows = catalogRows(statuses.data, DEFAULT_EMPLOYEE_STATUSES);
  const sectionRows = catalogRows(sections.data, DEFAULT_EMPLOYEE_SECTIONS);
  const nationRows = catalogRows(nationalityCategories.data, DEFAULT_NATIONALITY_CATEGORIES);
  const bankRows = catalogRows(banks.data, DEFAULT_BANK_CODES);
  const sponsorRows = catalogRows(sponsorships.data, DEFAULT_SPONSORSHIPS);
  /**
   * The four catalogs Employee Settings owns. Each keeps its compiled seed as the
   * fallback, so a catalog that has never been opened still offers the values the
   * app shipped with.
   */
  const hiringRows = catalogRows(hiringTypes.data, DEFAULT_HIRING_TYPES);
  const jobEndRows = catalogRows(jobEndDescriptions.data, DEFAULT_JOB_END_DESCRIPTIONS);
  const nationalityRows = catalogRows(nationalities.data, DEFAULT_NATIONALITIES);
  const currencyRows = catalogRows(paymentCurrencies.data, DEFAULT_PAYMENT_CURRENCIES);
  const hiringItems = hiringRows
    .filter((row) => row.is_active || row.key === form.hiringType)
    .map((row) => ({
      value: row.key,
      label: locale.startsWith("ar") ? row.label_ar || row.label_en : row.label_en,
    }));
  const jobEndItems = jobEndRows
    .filter((row) => row.is_active || row.key === form.jobEndDescription)
    .map((row) => ({
      value: row.key,
      label: locale.startsWith("ar") ? row.label_ar || row.label_en : row.label_en,
    }));
  const nationalityItems = nationalityRows
    .filter((row) => row.is_active || row.key === form.nationality)
    .map((row) => ({
      value: row.key,
      label: locale.startsWith("ar") ? row.label_ar || row.label_en : row.label_en,
      keywords: [row.key],
    }));
  const currencyItems = currencyRows
    .filter((row) => row.is_active || row.key === form.currency)
    .map((row) => ({
      value: row.key,
      label: `${row.key} — ${locale.startsWith("ar") ? row.label_ar || row.label_en : row.label_en}`,
    }));
  const companyOptions = listedCompanies(companies, form.sourceCompany || null);
  const companyItems = [
    { value: "none", label: t("fields.company") },
    ...companyOptions.map((row) => ({ value: row.key, label: row.name })),
  ];
  if (form.sourceCompany && !companyItems.some((item) => item.value === form.sourceCompany)) {
    companyItems.push({ value: form.sourceCompany, label: form.sourceCompany });
  }

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const errorText = (key: string): string => {
    const known = tNew(`errors.${key}` as never);
    return known && known !== `pages.driverNew.errors.${key}` ? known : key;
  };

  const allOpen = open.identity && open.status && open.bank && open.salary;

  const identityErrors = identityFieldErrors({
    civilId: form.civilId,
    phone: form.phone,
    passport: form.passportNumber,
  });
  const identityErrorFor = (field: IdentityField): string | null =>
    showIdentityErrors ? identityErrors[field] ?? null : null;
  const invalidClass = (field: IdentityField) =>
    identityErrorFor(field) ? "border-destructive ring-1 ring-destructive" : undefined;
  /** A legacy rider's gaps, listed by name so the operator knows what is owed. */
  const missingIdentityFields = Object.keys(identityErrors) as IdentityField[];

  const focusIdentityField = (field: IdentityField) => {
    setShowIdentityErrors(true);
    setOpen((current) => ({ ...current, identity: true }));
    requestAnimationFrame(() => document.getElementById(IDENTITY_INPUT_ID[field])?.focus());
  };

  // An approval refusal lands here: open the card, show the red fields, focus
  // the first thing the record still owes. The state changes and the focus run
  // in a frame so this stays an external-system effect, not a synchronous
  // cascade during render.
  useEffect(() => {
    if (!focusIdentityToken) return;
    const frame = requestAnimationFrame(() => {
      setShowIdentityErrors(true);
      setOpen((current) => ({ ...current, identity: true }));
      requestAnimationFrame(() => {
        const first = Object.keys(
          identityFieldErrors({
            civilId: form.civilId,
            phone: form.phone,
            passport: form.passportNumber,
          }),
        )[0] as IdentityField | undefined;
        document.getElementById(IDENTITY_INPUT_ID[first ?? "civilId"])?.focus();
      });
    });
    return () => cancelAnimationFrame(frame);
    // Only the token should trigger this; `form` changes on every keystroke and
    // must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdentityToken]);

  const submit = async () => {
    if (!driver.intake_id) {
      toast.error(t("needsIntake"));
      return;
    }
    /**
     * Civil ID, mobile and passport are mandatory. A refusal opens the Identity
     * card and focuses the first bad field rather than toasting something the
     * operator has to hunt for — a legacy rider can be missing any of the three.
     */
    const identityFailure = firstIdentityError({
      civilId: form.civilId,
      phone: form.phone,
      passport: form.passportNumber,
    });
    if (identityFailure) {
      setShowIdentityErrors(true);
      setOpen((current) => ({ ...current, identity: true }));
      toast.error(errorText(identityFailure.code));
      requestAnimationFrame(() => {
        document.getElementById(IDENTITY_INPUT_ID[identityFailure.field])?.focus();
      });
      return;
    }
    const data = new FormData();
    data.set("intakeId", driver.intake_id);
    data.set("fullName", form.fullName.trim());
    data.set("phone", form.phone);
    data.set("civilId", form.civilId);
    data.set("passportNumber", form.passportNumber);
    data.set("nationality", form.nationality);
    data.set("sectionKeys", form.sectionKeys.join(","));
    data.set("nationalityCategoryKeys", form.nationalityCategoryKeys.join(","));
    data.set("riderCategory", form.riderCategory);
    data.set("sourceCompany", form.sourceCompany);
    data.set("sponsorshipKey", form.sponsorshipKey);
    data.set("jobPosition", form.jobPosition);
    data.set("hiringType", form.hiringType);
    data.set("employeeStatusKey", form.employeeStatusKey);
    data.set("workStartDate", form.workStartDate);
    data.set("jobEndDate", form.jobEndDate);
    data.set("jobEndDescription", form.jobEndDescription);
    data.set("residencyExpiryDate", form.residencyExpiryDate);
    data.set("beneficiaryCivilId", form.beneficiaryCivilId);
    data.set("paymentCurrency", form.currency);
    data.set("bankCode", form.bankCode);
    data.set("accountNumber", form.accountNumber);
    data.set("iban", form.iban);
    data.set("fixedSalary", form.fixedSalary);
    data.set("workPermitSalary", form.workPermitSalary);
    data.set("lastIncrementDate", form.lastIncrementDate);

    setSaving(true);
    const result = await saveDriverPrivateInformation(data);
    setSaving(false);
    if (result.error) {
      toast.error(errorText(result.error));
      return;
    }
    toast.success(t("saved"));
    router.refresh();
  };

  const saveOffsStructure = async (value: string) => {
    setOffsDays(value);
    if (!driver.linked_profile_id) {
      toast.error(t("needsLink"));
      return;
    }
    setSavingOffs(true);
    const result = await setDriverOffStructure({
      driverId: driver.linked_profile_id,
      monthKey: kuwaitTodayYmd().slice(0, 7),
      offDays: value === "none" ? null : Number(value),
    });
    setSavingOffs(false);
    if ("error" in result) {
      toast.error(errorText(result.error));
      return;
    }
    toast.success(t("offsSaved"));
    router.refresh();
  };

  const nbk = isNbkBank(form.bankCode, bankRows);
  const statusItems = choiceItems(
    statusRows,
    locale,
    t("fields.selectStatus"),
    [form.employeeStatusKey],
  );
  const bankItems = bankChoiceItems(
    bankRows,
    locale,
    t("fields.selectBank"),
    t("fields.cash"),
    form.bankCode,
  );


  const closedAll: Record<CardKey, boolean> = {
    identity: false,
    status: false,
    bank: false,
    salary: false,
  };
  const openedAll: Record<CardKey, boolean> = {
    identity: true,
    status: true,
    bank: true,
    salary: true,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-foreground">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-10 rounded-lg px-3.5"
            onClick={() => setOpen(allOpen ? closedAll : openedAll)}
          >
            {allOpen ? t("collapseAll") : t("expandAll")}
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-10 rounded-lg px-3.5"
              disabled={saving}
              onClick={() => setForm(buildForm(driver))}
            >
              {t("discard")}
            </Button>
          ) : null}
          <Button
            type="button"
            className="min-h-10 rounded-lg bg-[#292A3F] px-3.5 text-white hover:bg-[#292A3F]/90"
            disabled={readonly || saving || !dirty}
            onClick={() => void submit()}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
      {readonly ? (
        <p className="text-xs text-muted-foreground">
          {driver.intake_id ? t("readOnly") : t("needsIntake")}
        </p>
      ) : null}

      {!readonly && missingIdentityFields.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          <p className="text-sm font-semibold">{t("identityIncompleteTitle")}</p>
          <p className="mt-0.5 text-xs leading-5">{t("identityIncompleteBody")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {missingIdentityFields.map((field) => (
              <button
                key={field}
                type="button"
                onClick={() => focusIdentityField(field)}
                className="cursor-pointer rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
              >
                {t(
                  field === "civilId"
                    ? "fields.civilId"
                    : field === "phone"
                      ? "fields.phone"
                      : "fields.passport",
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <AccordionCard
        id="profile-identity"
        title={t("cards.identity")}
        count={t("fields.fieldsCount", { count: 13 })}
        open={open.identity}
        onToggle={() => setOpen((current) => ({ ...current, identity: !current.identity }))}
      >
        <div className={GRID}>
          <FieldBlock className={W2}>
            <FieldLabel className={LABEL} htmlFor="p-full-name" required>
              {t("fields.fullName")}
            </FieldLabel>
            <Input
              id="p-full-name"
              className={FIELD}
              value={form.fullName}
              disabled={readonly}
              onChange={(event) => set("fullName", event.target.value)}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL} htmlFor="p-employee-id">{t("fields.employeeId")}</FieldLabel>
            <Input id="p-employee-id" className={cn(FIELD, "bg-muted")} value={driver.employee_id ?? "—"} readOnly disabled />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL} htmlFor="p-civil" required>
              {t("fields.civilId")}
            </FieldLabel>
            <Input
              id="p-civil"
              className={cn(FIELD, invalidClass("civilId"))}
              inputMode="numeric"
              maxLength={12}
              aria-invalid={Boolean(identityErrorFor("civilId"))}
              value={form.civilId}
              disabled={readonly}
              onChange={(event) => {
                const next = event.target.value;
                // One state update: the beneficiary mirror reads the same value,
                // which keeps a fast typist from writing the previous keystroke.
                setForm((current) => ({
                  ...current,
                  civilId: next,
                  beneficiaryCivilId: beneficiaryTouched ? current.beneficiaryCivilId : next,
                }));
              }}
            />
            {identityErrorFor("civilId") ? (
              <p className="text-[10px] text-destructive">{errorText(identityErrorFor("civilId")!)}</p>
            ) : null}
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL} htmlFor="p-phone" required>
              {t("fields.phone")}
            </FieldLabel>
            <Input
              id="p-phone"
              className={cn(FIELD, invalidClass("phone"))}
              inputMode="tel"
              maxLength={16}
              placeholder="+965"
              aria-invalid={Boolean(identityErrorFor("phone"))}
              value={form.phone}
              disabled={readonly}
              onChange={(event) => set("phone", event.target.value)}
            />
            {identityErrorFor("phone") ? (
              <p className="text-[10px] text-destructive">{errorText(identityErrorFor("phone")!)}</p>
            ) : null}
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL} htmlFor="p-passport" required>
              {t("fields.passport")}
            </FieldLabel>
            <Input
              id="p-passport"
              className={cn(FIELD, "font-mono uppercase", invalidClass("passport"))}
              maxLength={20}
              aria-invalid={Boolean(identityErrorFor("passport"))}
              value={form.passportNumber}
              disabled={readonly}
              onChange={(event) =>
                set("passportNumber", event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
              }
            />
            {identityErrorFor("passport") ? (
              <p className="text-[10px] text-destructive">{errorText(identityErrorFor("passport")!)}</p>
            ) : null}
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL}>{t("fields.nationalityCountry")}</FieldLabel>
            <SearchableSelect
              value={form.nationality}
              onValueChange={(value) => set("nationality", value)}
              items={nationalityItems.length > 0 ? nationalityItems : countrySearchSelectItems()}
              placeholder={t("fields.selectCountry")}
              searchPlaceholder={t("fields.searchCountry")}
              recentsKey="driver-nationality-country"
              disabled={readonly}
              className={cn(FIELD, "w-full")}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL}>{t("fields.nationalityCategory")}</FieldLabel>
            {/* Twenty-five nationalities plus the four groups: a plain Select is an unsearchable wall. */}
            <SearchableSelect
              value={form.nationalityCategoryKeys[0] || "none"}
              onValueChange={(value) =>
                set("nationalityCategoryKeys", !value || value === "none" ? [] : [value])
              }
              items={choiceItems(
                nationRows,
                locale,
                t("fields.selectCategory"),
                form.nationalityCategoryKeys,
              )}
              placeholder={t("fields.selectCategory")}
              searchPlaceholder={t("fields.searchCategory")}
              recentsKey="driver-nationality-category"
              disabled={readonly}
              className={cn(FIELD, "w-full")}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL}>{t("fields.category")}</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {(["in_house", "outsourced"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={readonly}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      riderCategory: value,
                      sourceCompany:
                        value === "in_house"
                          ? (companies.find((row) => row.is_system && row.is_active)?.key ?? "")
                          : current.sourceCompany,
                    }))
                  }
                  className={cn(
                    "min-h-[42px] cursor-pointer rounded-lg border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50",
                    form.riderCategory === value
                      ? "border-[#292A3F] bg-[#ECECF3] font-bold text-foreground"
                      : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {t(value === "in_house" ? "fields.inHouse" : "fields.outsourced")}
                </button>
              ))}
            </div>
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL}>{t("fields.company")}</FieldLabel>
            <Select
              items={companyItems}
              value={form.sourceCompany || "none"}
              onValueChange={(value) => set("sourceCompany", !value || value === "none" ? "" : value)}
            >
              <SelectTrigger className={cn(FIELD, "w-full")} disabled={readonly}>
                <SelectValue placeholder={t("fields.company")} />
              </SelectTrigger>
              <SelectContent>
                {companyItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL}>{t("fields.sponsorship")}</FieldLabel>
            {/* Fifty-one sponsor companies: a plain Select would be an unsearchable wall. */}
            <SearchableSelect
              value={form.sponsorshipKey || "none"}
              onValueChange={(value) => set("sponsorshipKey", !value || value === "none" ? "" : value)}
              items={choiceItems(sponsorRows, locale, t("fields.selectSponsorship"), [form.sponsorshipKey])}
              placeholder={t("fields.selectSponsorship")}
              searchPlaceholder={t("fields.searchSponsorship")}
              recentsKey="driver-sponsorship"
              disabled={readonly}
              className={cn(FIELD, "w-full")}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL}>{t("fields.jobPosition")}</FieldLabel>
            <Select
              items={[{ value: "none", label: t("fields.selectJob") }, ...jobPositionOptions]}
              value={form.jobPosition || "none"}
              onValueChange={(value) => set("jobPosition", !value || value === "none" ? "" : value)}
            >
              <SelectTrigger className={cn(FIELD, "w-full")} disabled={readonly}>
                <SelectValue placeholder={t("fields.selectJob")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("fields.selectJob")}</SelectItem>
                {jobPositionOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL}>{t("fields.hiringType")}</FieldLabel>
            <Select
              items={[{ value: "none", label: t("fields.selectHiring") }, ...hiringItems]}
              value={form.hiringType || "none"}
              onValueChange={(value) => set("hiringType", !value || value === "none" ? "" : value)}
            >
              <SelectTrigger className={cn(FIELD, "w-full")} disabled={readonly}>
                <SelectValue placeholder={t("fields.selectHiring")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("fields.selectHiring")}</SelectItem>
                {hiringItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
          <FieldBlock className={W2}>
            <FieldLabel className={LABEL}>{t("fields.section")}</FieldLabel>
            <Select
              items={choiceItems(sectionRows, locale, t("fields.selectSection"), form.sectionKeys)}
              value={form.sectionKeys[0] || "none"}
              onValueChange={(value) => set("sectionKeys", !value || value === "none" ? [] : [value])}
            >
              <SelectTrigger className={cn(FIELD, "w-full")} disabled={readonly}>
                <SelectValue placeholder={t("fields.selectSection")} />
              </SelectTrigger>
              <SelectContent>
                {choiceItems(sectionRows, locale, t("fields.selectSection"), form.sectionKeys).map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
        </div>
      </AccordionCard>

      <AccordionCard
        id="profile-status"
        title={t("cards.status")}
        count={t("fields.fieldsCount", { count: 5 })}
        open={open.status}
        onToggle={() => setOpen((current) => ({ ...current, status: !current.status }))}
      >
        <div className={GRID}>
          <FieldBlock>
            <FieldLabel>{t("fields.employeeStatus")}</FieldLabel>
            <Select
              items={statusItems}
              value={form.employeeStatusKey || "none"}
              onValueChange={(value) =>
                set("employeeStatusKey", !value || value === "none" ? "" : value)
              }
            >
              <SelectTrigger className={cn(FIELD, "w-full")} disabled={readonly}>
                <SelectValue placeholder={t("fields.selectStatus")} />
              </SelectTrigger>
              <SelectContent>
                {statusItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
          <FieldBlock>
            <FieldLabel htmlFor="p-work-start">{t("fields.workStart")}</FieldLabel>
            <Input
              id="p-work-start"
              type="date"
              className={FIELD}
              value={form.workStartDate}
              disabled={readonly}
              onChange={(event) => set("workStartDate", event.target.value)}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel htmlFor="p-residency">{t("fields.residencyExpiry")}</FieldLabel>
            <Input
              id="p-residency"
              type="date"
              className={FIELD}
              value={form.residencyExpiryDate}
              disabled={readonly}
              onChange={(event) => set("residencyExpiryDate", event.target.value)}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel htmlFor="p-job-end">{t("fields.jobEndDate")}</FieldLabel>
            <Input
              id="p-job-end"
              type="date"
              className={FIELD}
              value={form.jobEndDate}
              disabled={readonly}
              onChange={(event) => set("jobEndDate", event.target.value)}
            />
          </FieldBlock>
          <FieldBlock className={W2}>
            <FieldLabel>{t("fields.jobEndDescription")}</FieldLabel>
            <Select
              items={[
                { value: "none", label: t("options.jobEndDescription.none") },
                ...jobEndItems,
              ]}
              value={form.jobEndDescription || "none"}
              onValueChange={(value) =>
                set("jobEndDescription", value === "none" ? "" : (value ?? ""))
              }
            >
              <SelectTrigger className={cn(FIELD, "w-full")} disabled={readonly}>
                <SelectValue placeholder={t("fields.jobEndDescription")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("options.jobEndDescription.none")}</SelectItem>
                {jobEndItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
        </div>
      </AccordionCard>


      <AccordionCard
        id="profile-bank"
        title={t("cards.bank")}
        count={t("fields.fieldsCount", { count: 4 })}
        open={open.bank}
        onToggle={() => setOpen((current) => ({ ...current, bank: !current.bank }))}
      >
        <div className={GRID}>
          <FieldBlock>
            <FieldLabel htmlFor="p-beneficiary">{t("fields.beneficiaryCivilId")}</FieldLabel>
            <Input
              id="p-beneficiary"
              className={FIELD}
              inputMode="numeric"
              maxLength={12}
              value={form.beneficiaryCivilId}
              disabled={readonly}
              onChange={(event) => {
                setBeneficiaryTouched(true);
                set("beneficiaryCivilId", event.target.value);
              }}
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              {beneficiaryTouched ? t("fields.beneficiaryOverride") : t("fields.beneficiarySynced")}
            </p>
            {beneficiaryTouched ? (
              <button
                type="button"
                disabled={readonly}
                className="w-fit cursor-pointer text-[10px] font-semibold text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  setBeneficiaryTouched(false);
                  set("beneficiaryCivilId", form.civilId);
                }}
              >
                {t("fields.beneficiaryReset")}
              </button>
            ) : null}
          </FieldBlock>
          <FieldBlock>
            <FieldLabel>{t("fields.bank")}</FieldLabel>
            <Select
              items={bankItems}
              value={form.bankCode || "none"}
              onValueChange={(value) => set("bankCode", !value || value === "none" ? "" : value)}
            >
              <SelectTrigger className={cn(FIELD, "w-full")} disabled={readonly}>
                <SelectValue placeholder={t("fields.selectBank")} />
              </SelectTrigger>
              <SelectContent>
                {bankItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
          {form.bankCode === "cash" ? null : nbk ? (
            <FieldBlock>
              <FieldLabel htmlFor="p-account">{t("fields.accountNumber")}</FieldLabel>
              <Input
                id="p-account"
                className={FIELD}
                inputMode="numeric"
                value={form.accountNumber}
                disabled={readonly}
                onChange={(event) => set("accountNumber", event.target.value)}
              />
            </FieldBlock>
          ) : (
            <FieldBlock>
              <FieldLabel htmlFor="p-iban">{t("fields.bankNumber")}</FieldLabel>
              <Input
                id="p-iban"
                className={cn(FIELD, "font-mono")}
                value={form.iban}
                disabled={readonly}
                placeholder="KW…"
                onChange={(event) => set("iban", event.target.value.toUpperCase())}
              />
            </FieldBlock>
          )}
          <FieldBlock>
            <FieldLabel htmlFor="p-currency">{t("fields.currency")}</FieldLabel>
            <Select
              items={
                currencyItems.length > 0
                  ? currencyItems
                  : PAYMENT_CURRENCIES.map((currency) => ({
                      value: currency.code,
                      label: `${currency.code} · ${currency.name}`,
                    }))
              }
              value={form.currency}
              onValueChange={(value) => {
                if (!value) return;
                set("currency", normalizePaymentCurrency(value));
              }}
            >
              <SelectTrigger id="p-currency" className={cn(FIELD, "w-full")} disabled={readonly}>
                <SelectValue placeholder={t("fields.currency")} />
              </SelectTrigger>
              <SelectContent>
                {(currencyItems.length > 0
                  ? currencyItems
                  : PAYMENT_CURRENCIES.map((currency) => ({
                      value: currency.code,
                      label: `${currency.code} · ${currency.name}`,
                    }))
                ).map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
        </div>
        {bank?.iban ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("fields.maskedBankNumber")}: {bank.iban.slice(0, 4)}…{bank.iban.slice(-4)}
          </p>
        ) : null}
      </AccordionCard>


      <AccordionCard
        id="profile-salary"
        title={t("cards.salary")}
        count={t("fields.fieldsCount", { count: 4 })}
        open={open.salary}
        onToggle={() => setOpen((current) => ({ ...current, salary: !current.salary }))}
      >
        <div className={GRID}>
          <FieldBlock>
            <FieldLabel htmlFor="p-fixed-salary">{t("fields.fixedSalary")}</FieldLabel>
            <Input
              id="p-fixed-salary"
              className={FIELD}
              type="number"
              min={0}
              step="0.001"
              inputMode="decimal"
              value={form.fixedSalary}
              disabled={readonly}
              onChange={(event) => set("fixedSalary", event.target.value)}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel htmlFor="p-permit-salary">{t("fields.workPermitSalary")}</FieldLabel>
            <Input
              id="p-permit-salary"
              className={FIELD}
              type="number"
              min={0}
              step="0.001"
              inputMode="decimal"
              value={form.workPermitSalary}
              disabled={readonly}
              onChange={(event) => set("workPermitSalary", event.target.value)}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel>{t("fields.offsStructure")}</FieldLabel>
            <Select
              items={[
                { value: "none", label: t("fields.offsNone") },
                ...OFFS_STRUCTURE_DAYS.map((days) => ({
                  value: String(days),
                  label: t("fields.offsDays", { days }),
                })),
              ]}
              value={offsDays}
              onValueChange={(value) => void saveOffsStructure(value ?? "none")}
            >
              <SelectTrigger className={cn(FIELD, "w-full")} disabled={!canManage || savingOffs}>
                <SelectValue placeholder={t("fields.offsStructure")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("fields.offsNone")}</SelectItem>
                {OFFS_STRUCTURE_DAYS.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {t("fields.offsDays", { days })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
          <FieldBlock>
            <FieldLabel htmlFor="p-last-increment">{t("fields.lastIncrement")}</FieldLabel>
            <Input
              id="p-last-increment"
              type="date"
              className={FIELD}
              value={form.lastIncrementDate}
              disabled={readonly}
              onChange={(event) => set("lastIncrementDate", event.target.value)}
            />
          </FieldBlock>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("fields.offsHint")}</p>
      </AccordionCard>

    </div>
  );
}

