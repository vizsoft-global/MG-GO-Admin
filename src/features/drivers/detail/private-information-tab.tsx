"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DEFAULT_NATIONALITY_CATEGORIES,
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
  useNationalityCategories,
  useSponsorships,
} from "@/features/employees/use-employee-catalogs";
import { setDriverOffStructure } from "@/features/payroll/payroll-actions";
import {
  HIRING_TYPES,
  JOB_END_DESCRIPTIONS,
  JOB_POSITIONS,
  OFFS_STRUCTURE_DAYS,
} from "../driver-private-fields";
import { saveDriverPrivateInformation } from "../drivers-actions";
import { FieldBlock, FieldLabel } from "../form/driver-form-primitives";
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
    fixedSalary: info.fixed_salary != null ? String(info.fixed_salary) : "",
    workPermitSalary: info.work_permit_salary != null ? String(info.work_permit_salary) : "",
    lastIncrementDate: info.last_increment_date ?? "",
  };
}

export function PrivateInformationTab({
  driver,
  canManage,
}: {
  driver: DriverDetailModel;
  canManage: boolean;
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

  const readonly = !canManage || !driver.intake_id;
  const bank = driver.bank_details;

  const [form, setForm] = useState(() => buildForm(driver));
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

  const submit = async () => {
    if (!driver.intake_id) {
      toast.error(t("needsIntake"));
      return;
    }
    const data = new FormData();
    data.set("intakeId", driver.intake_id);
    data.set("fullName", form.fullName.trim());
    data.set("phone", form.phone);
    data.set("civilId", form.civilId);
    data.set("passportNumber", form.passportNumber);
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

      <AccordionCard
        id="profile-identity"
        title={t("cards.identity")}
        count={t("fields.fieldsCount", { count: 12 })}
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
            <FieldLabel className={LABEL} htmlFor="p-civil">{t("fields.civilId")}</FieldLabel>
            <Input
              id="p-civil"
              className={FIELD}
              inputMode="numeric"
              value={form.civilId}
              disabled={readonly}
              onChange={(event) => set("civilId", event.target.value)}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL} htmlFor="p-phone">{t("fields.phone")}</FieldLabel>
            <Input
              id="p-phone"
              className={FIELD}
              inputMode="tel"
              placeholder="+965"
              value={form.phone}
              disabled={readonly}
              onChange={(event) => set("phone", event.target.value)}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL} htmlFor="p-passport">{t("fields.passport")}</FieldLabel>
            <Input
              id="p-passport"
              className={FIELD}
              value={form.passportNumber}
              disabled={readonly}
              onChange={(event) => set("passportNumber", event.target.value)}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL}>{t("fields.nationality")}</FieldLabel>
            <Select
              items={choiceItems(nationRows, locale, t("fields.selectCategory"), form.nationalityCategoryKeys)}
              value={form.nationalityCategoryKeys[0] || "none"}
              onValueChange={(value) =>
                set("nationalityCategoryKeys", !value || value === "none" ? [] : [value])
              }
            >
              <SelectTrigger className={cn(FIELD, "w-full")} disabled={readonly}>
                <SelectValue placeholder={t("fields.selectCategory")} />
              </SelectTrigger>
              <SelectContent>
                {choiceItems(nationRows, locale, t("fields.selectCategory"), form.nationalityCategoryKeys).map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Select
              items={choiceItems(sponsorRows, locale, t("fields.selectSponsorship"), [form.sponsorshipKey])}
              value={form.sponsorshipKey || "none"}
              onValueChange={(value) => set("sponsorshipKey", !value || value === "none" ? "" : value)}
            >
              <SelectTrigger className={cn(FIELD, "w-full")} disabled={readonly}>
                <SelectValue placeholder={t("fields.selectSponsorship")} />
              </SelectTrigger>
              <SelectContent>
                {choiceItems(sponsorRows, locale, t("fields.selectSponsorship"), [form.sponsorshipKey]).map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL}>{t("fields.jobPosition")}</FieldLabel>
            <Select
              items={[{ value: "none", label: t("fields.selectJob") }, ...JOB_POSITIONS.map((value) => ({ value, label: t(`options.jobPosition.${value}`) }))]}
              value={form.jobPosition || "none"}
              onValueChange={(value) => set("jobPosition", !value || value === "none" ? "" : value)}
            >
              <SelectTrigger className={cn(FIELD, "w-full")} disabled={readonly}>
                <SelectValue placeholder={t("fields.selectJob")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("fields.selectJob")}</SelectItem>
                {JOB_POSITIONS.map((value) => (
                  <SelectItem key={value} value={value}>{t(`options.jobPosition.${value}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
          <FieldBlock>
            <FieldLabel className={LABEL}>{t("fields.hiringType")}</FieldLabel>
            <Select
              items={[{ value: "none", label: t("fields.selectHiring") }, ...HIRING_TYPES.map((value) => ({ value, label: t(`options.hiringType.${value}`) }))]}
              value={form.hiringType || "none"}
              onValueChange={(value) => set("hiringType", !value || value === "none" ? "" : value)}
            >
              <SelectTrigger className={cn(FIELD, "w-full")} disabled={readonly}>
                <SelectValue placeholder={t("fields.selectHiring")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("fields.selectHiring")}</SelectItem>
                {HIRING_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>{t(`options.hiringType.${value}`)}</SelectItem>
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
                ...JOB_END_DESCRIPTIONS.map((value) => ({
                  value,
                  label: t(`options.jobEndDescription.${value}`),
                })),
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
                {JOB_END_DESCRIPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`options.jobEndDescription.${value}`)}
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
              value={form.beneficiaryCivilId}
              disabled={readonly}
              onChange={(event) => set("beneficiaryCivilId", event.target.value)}
            />
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
            <Input id="p-currency" className={FIELD} value="KWD" readOnly disabled />
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

