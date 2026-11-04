"use client";

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { AppFormSection } from "@/components/app/app-form-section";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchSelect } from "@/components/ui/search-select";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { formatKwd } from "@/lib/format/money";
import { queryKeys } from "@/lib/query/query-keys";
import { partTotal, recordDay } from "./service-records-model";
import { serviceTypeSearchText } from "./service-types";
import { ServiceAttachments } from "./service-attachments";
import { createServiceRecord, updateServiceRecord } from "./service-actions";
import { serviceErrorKey, useServiceTypeCatalog, useServiceVehicles } from "./use-service";
import type { ServiceAttachmentMeta, ServiceRecordRow } from "./types";

type PartDraft = { name: string; qty: string; unit: string };

const EMPTY_PART: PartDraft = { name: "", qty: "1", unit: "" };

function draftFrom(record: ServiceRecordRow | null): PartDraft[] {
  if (!record || record.parts.length === 0) return [{ ...EMPTY_PART }];
  return record.parts.map((part) => ({
    name: part.name,
    qty: String(part.qty),
    unit: String(part.unit_cost_kwd),
  }));
}

export function ServiceRecordForm({
  record,
  initialVehicleId,
}: {
  record?: ServiceRecordRow | null;
  initialVehicleId?: string;
}) {
  const t = useTranslations("pages.fleetService");
  const router = useRouter();
  const queryClient = useQueryClient();
  const vehicles = useServiceVehicles();
  const types = useServiceTypeCatalog();

  const today = kuwaitTodayYmd();
  const [vehicleId, setVehicleId] = useState(record?.vehicle_id ?? initialVehicleId ?? "");
  const [serviceTypeKey, setServiceTypeKey] = useState(record?.service_type_key ?? "");
  const [description, setDescription] = useState(record?.description ?? "");
  const [servicedAt, setServicedAt] = useState(record ? recordDay(record) : today);
  const [odometer, setOdometer] = useState(
    record ? String(record.odometer_km ?? record.odometer ?? "") : "",
  );
  const [vendor, setVendor] = useState(record?.vendor ?? "");
  const [cost, setCost] = useState(record?.cost_kwd == null ? "" : String(record.cost_kwd));
  const [invoiceNo, setInvoiceNo] = useState(record?.invoice_no ?? "");
  const [invoiceDate, setInvoiceDate] = useState(record?.invoice_date ?? "");
  const [company, setCompany] = useState(record?.company ?? "");
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [driverId, setDriverId] = useState(record?.driver_id ?? "");
  const [parts, setParts] = useState<PartDraft[]>(draftFrom(record ?? null));
  const [attachments, setAttachments] = useState<ServiceAttachmentMeta[]>(
    record?.attachments ?? [],
  );
  const [saving, setSaving] = useState(false);

  const selectedVehicle = useMemo(
    () => (vehicles.data ?? []).find((row) => row.id === vehicleId) ?? null,
    [vehicles.data, vehicleId],
  );
  // The employee block is derived from the roster: the MG ID and the company are
  // read from the linked driver, so an operator cannot type a company that
  // disagrees with the employee record.
  const employeeId = selectedVehicle?.employee_id ?? record?.employee_id ?? null;
  const employeeCompany = selectedVehicle?.employee_company ?? null;

  const vehicleItems = useMemo(
    () =>
      (vehicles.data ?? []).map((row) => ({
        value: row.id,
        label: [row.plate, row.model].filter(Boolean).join(" · "),
        hint:
          [row.make, row.model_year, row.driver_name].filter(Boolean).join(" · ") || undefined,
        keywords: [row.plate, row.chassis_no, row.make, row.model, row.driver_name]
          .filter(Boolean)
          .join(" ")
          .split(" "),
      })),
    [vehicles.data],
  );

  const typeItems = useMemo(
    () =>
      (types.data ?? [])
        .filter((row) => row.is_active || row.key === record?.service_type_key)
        .map((row) => ({
          value: row.key,
          label: row.label_en,
          hint: `${t(`categories.${row.category}`)}${row.label_ar ? ` · ${row.label_ar}` : ""}`,
          keywords: serviceTypeSearchText(row).split(" "),
        })),
    [types.data, record?.service_type_key, t],
  );

  function selectVehicle(next: string | null) {
    setVehicleId(next ?? "");
    const row = (vehicles.data ?? []).find((item) => item.id === next);
    if (!row) return;
    setDriverId(row.driver_id ?? "");
    // The employee's own company wins; the vehicle's registered company is only a
    // fallback for a plate with no rider assigned.
    setCompany(row.employee_company ?? row.company_name ?? "");
    if (!odometer.trim() && row.current_odometer_km != null) {
      setOdometer(String(row.current_odometer_km));
    }
  }

  function updatePart(index: number, patch: Partial<PartDraft>) {
    setParts((current) =>
      current.map((part, position) => (position === index ? { ...part, ...patch } : part)),
    );
  }

  const partsTotalValue = parts.reduce((sum, part) => sum + partTotal(part.qty, part.unit), 0);

  async function submit() {
    setSaving(true);
    const input = {
      vehicleId,
      servicedAt,
      description,
      serviceTypeKey,
      driverId,
      invoiceNo,
      invoiceDate,
      company: employeeCompany ?? company,
      vendor,
      notes,
      odometerKm: odometer.trim() === "" ? null : Number(odometer),
      costKwd: cost.trim() === "" ? null : Number(cost),
      attachments,
      parts: parts
        .filter((part) => part.name.trim())
        .map((part) => ({
          name: part.name.trim(),
          qty: Number(part.qty || 0),
          unit_cost_kwd: Number(part.unit || 0),
          total_kwd: partTotal(part.qty, part.unit),
        })),
    };

    const result = record
      ? await updateServiceRecord(record.id, input)
      : await createServiceRecord(input);
    setSaving(false);

    if ("error" in result) {
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(record ? t("saved") : t("created"));
    void queryClient.invalidateQueries({ queryKey: queryKeys.service.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
    const id = "id" in result ? result.id : record?.id;
    router.push(id ? `/fleet/service/records/${id}` : "/fleet/service");
    router.refresh();
  }


  return (
    <AppPage className="space-y-4">
      <AppPageHeader
        title={record ? t("form.titleEdit") : t("form.titleNew")}
        description={record ? t("form.subtitleEdit") : t("form.subtitleNew")}
        breadcrumbs={[
          { label: t("title"), href: "/fleet/service" },
          { label: record ? t("form.titleEdit") : t("form.titleNew") },
        ]}
      />

      <AppFormSection title={t("form.sectionService")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("form.vehicle")}</span>
            <SearchSelect
              items={vehicleItems}
              value={vehicleId || null}
              onChange={selectVehicle}
              placeholder={t("form.selectVehicle")}
              searchPlaceholder={t("form.searchVehicle")}
              emptyText={t("form.noVehicles")}
              recentsKey="service-vehicle"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("form.serviceType")}</span>
            <SearchSelect
              items={typeItems}
              value={serviceTypeKey || null}
              onChange={(next) => setServiceTypeKey(next ?? "")}
              placeholder={t("form.selectType")}
              searchPlaceholder={t("form.searchType")}
              emptyText={t("form.noTypes")}
              recentsKey="service-type"
            />
            <span className="block text-[10px] text-muted-foreground">
              {t("form.serviceTypeHint")}
            </span>
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("form.description")}</span>
            <Input
              className="h-9"
              value={description}
              maxLength={140}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("form.descriptionPlaceholder")}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("cols.date")}</span>
            <Input
              type="date"
              className="h-9"
              max={today}
              value={servicedAt}
              onChange={(event) => setServicedAt(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("cols.odometer")}</span>
            <Input
              type="number"
              min={0}
              className="h-9 tabular-nums"
              value={odometer}
              onChange={(event) => setOdometer(event.target.value)}
              placeholder={t("form.odometerPlaceholder")}
            />
            <span className="block text-[10px] text-muted-foreground">
              {t("form.odometerHint")}
            </span>
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("form.driver")}</span>
            <Input
              className="h-9"
              value={selectedVehicle?.driver_name ?? record?.driver_name ?? ""}
              readOnly
              placeholder={t("form.noDriver")}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("form.employeeId")}</span>
            <Input
              className="h-9 tabular-nums"
              value={employeeId ?? ""}
              readOnly
              placeholder={t("form.noEmployeeId")}
            />
            <span className="block text-[10px] text-muted-foreground">
              {t("form.employeeIdHint")}
            </span>
          </label>
        </div>
      </AppFormSection>

      <AppFormSection title={t("form.sectionInvoice")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("cols.vendor")}</span>
            <Input
              className="h-9"
              value={vendor}
              maxLength={120}
              onChange={(event) => setVendor(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("cols.cost")}</span>
            <Input
              type="number"
              min={0}
              step="0.001"
              className="h-9 tabular-nums"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("detail.invoiceNo")}</span>
            <Input
              className="h-9"
              value={invoiceNo}
              maxLength={60}
              onChange={(event) => setInvoiceNo(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("detail.invoiceDate")}</span>
            <Input
              type="date"
              className="h-9"
              max={today}
              value={invoiceDate}
              onChange={(event) => setInvoiceDate(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("cols.company")}</span>
            <Input
              className="h-9"
              value={employeeCompany ?? company}
              readOnly={employeeCompany != null}
              maxLength={120}
              onChange={(event) => setCompany(event.target.value)}
            />
            <span className="block text-[10px] text-muted-foreground">
              {employeeCompany != null ? t("form.companyAutoHint") : t("form.companyHint")}
            </span>
          </label>
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="block font-medium">{t("form.notes")}</span>
            <Textarea
              className="min-h-[64px]"
              value={notes}
              maxLength={400}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>
      </AppFormSection>

      <AppFormSection
        title={t("form.sectionParts")}
        description={t("detail.partsTotal", { total: formatKwd(partsTotalValue) })}
        action={
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => setParts((current) => [...current, { ...EMPTY_PART }])}
          >
            <Plus className="h-4 w-4" />
            {t("form.addPart")}
          </Button>
        }
      >
        <div className="space-y-2">
          {parts.map((part, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2">
              <label className="min-w-[12rem] flex-1 space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("form.partName")}</span>
                <Input
                  className="h-9"
                  value={part.name}
                  maxLength={120}
                  onChange={(event) => updatePart(index, { name: event.target.value })}
                />
              </label>
              <label className="w-20 space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("form.partQty")}</span>
                <Input
                  type="number"
                  min={0}
                  className="h-9 tabular-nums"
                  value={part.qty}
                  onChange={(event) => updatePart(index, { qty: event.target.value })}
                />
              </label>
              <label className="w-28 space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("form.partUnit")}</span>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  className="h-9 tabular-nums"
                  value={part.unit}
                  onChange={(event) => updatePart(index, { unit: event.target.value })}
                />
              </label>
              <div className="w-24 space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("form.partTotal")}</span>
                <p className="flex h-9 items-center justify-end tabular-nums">
                  {formatKwd(partTotal(part.qty, part.unit))}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-9 w-9"
                aria-label={t("form.removePart")}
                title={t("form.removePart")}
                onClick={() =>
                  setParts((current) =>
                    current.length === 1 ? [{ ...EMPTY_PART }] : current.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </AppFormSection>

      <AppFormSection title={t("form.sectionAttachments")} description={t("form.attachmentsHint")}>
        <ServiceAttachments
          vehicleId={vehicleId}
          attachments={attachments}
          canManage
          onChange={setAttachments}
        />
      </AppFormSection>

      <AppModalFooter
        asPage
        title={record ? t("form.titleEdit") : t("form.titleNew")}
        subtitle={t("form.footerHint")}
      >
        <Button
          type="button"
          variant="outline"
          className="h-9"
          onClick={() => router.push("/fleet/service")}
        >
          {t("actions.cancel")}
        </Button>
        <Button type="button" className="h-9" disabled={saving} onClick={() => void submit()}>
          {t("actions.save")}
        </Button>
      </AppModalFooter>
    </AppPage>
  );
}
