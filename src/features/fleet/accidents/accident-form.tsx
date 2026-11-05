"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { AppFormSection } from "@/components/app/app-form-section";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/query/query-keys";
import { AccidentAttachments } from "./accident-attachments";
import { createAccident, removeAccidentAttachment, updateAccident } from "./accident-actions";
import {
  ACCIDENT_CASE_STATUSES,
  DRIVER_FAULT_VALUES,
  INSURANCE_CLAIM_STATUSES,
  POLICE_REPORT_STATUSES,
  REPLACEMENT_CASE_STATUSES,
  VEHICLE_CASE_STATUSES,
  type AccidentAttachmentMeta,
  type AccidentInput,
  type AccidentRow,
} from "./accident-types";
import { accidentErrorKey, useAccidentVehicles } from "./use-accidents";

/** Local `YYYY-MM-DDTHH:mm`, the `datetime-local` wire format and its `max`. */
function localDateTimeInputMax(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`;
}

/** Stored ISO instant → the local `datetime-local` value the input needs. */
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function AccidentForm({
  accident,
  initialVehicleId,
  canManage,
}: {
  accident?: AccidentRow | null;
  initialVehicleId?: string;
  canManage: boolean;
}) {
  const t = useTranslations("pages.fleetAccidents");
  const tCase = useTranslations("pages.fleetAccidents.caseStatus");
  const tFault = useTranslations("pages.fleetAccidents.driverFault");
  const tVehicleCase = useTranslations("pages.fleetAccidents.vehicleCaseStatus");
  const tClaim = useTranslations("pages.fleetAccidents.insuranceClaimStatus");
  const tPolice = useTranslations("pages.fleetAccidents.policeReportStatus");
  const router = useRouter();
  const queryClient = useQueryClient();
  const vehicles = useAccidentVehicles();
  const editing = Boolean(accident);

  const [vehicleId, setVehicleId] = useState(accident?.vehicle_id ?? initialVehicleId ?? "");
  const [occurredAt, setOccurredAt] = useState(
    accident ? toLocalInput(accident.occurred_at) : localDateTimeInputMax(),
  );
  const [locationText, setLocationText] = useState(accident?.location_text ?? "");
  const [lat, setLat] = useState(accident?.location_lat == null ? "" : String(accident.location_lat));
  const [lng, setLng] = useState(accident?.location_lng == null ? "" : String(accident.location_lng));
  const [driverFault, setDriverFault] = useState(accident?.driver_fault ?? "");
  const [caseStatus, setCaseStatus] = useState(accident?.case_status ?? "pending");
  const [vehicleCaseStatus, setVehicleCaseStatus] = useState(accident?.vehicle_case_status ?? "");
  const [insuranceCompany, setInsuranceCompany] = useState(accident?.insurance_company ?? "");
  const [insuranceClaimStatus, setInsuranceClaimStatus] = useState(
    accident?.insurance_claim_status ?? "",
  );
  const [policeReportStatus, setPoliceReportStatus] = useState(accident?.police_report_status ?? "");
  const [amountKwd, setAmountKwd] = useState(
    accident?.amount_kwd == null ? "" : String(accident.amount_kwd),
  );
  const [otherPartyName, setOtherPartyName] = useState(accident?.other_party_name ?? "");
  const [otherPartyPlate, setOtherPartyPlate] = useState(accident?.other_party_plate ?? "");
  const [otherPartyPhone, setOtherPartyPhone] = useState(accident?.other_party_phone ?? "");
  const [description, setDescription] = useState(accident?.description ?? accident?.notes ?? "");
  const [fleetComment, setFleetComment] = useState(accident?.fleet_comment ?? "");
  const [replacementPlate, setReplacementPlate] = useState(accident?.replacement_plate ?? "");
  const [severity, setSeverity] = useState(accident?.severity ?? "");
  const [attachments, setAttachments] = useState<AccidentAttachmentMeta[]>(
    accident?.attachments ?? [],
  );
  const [saving, setSaving] = useState(false);
  /**
   * The picker's `max` is the current minute. Producing it during render makes the
   * server render one minute and the browser hydrate a later one, which React
   * reports as an attribute mismatch; setting state in an effect is what the
   * `react-hooks/set-state-in-effect` rule forbids. So the attribute is written
   * onto the input after mount, and the server-side `future_date` refusal stays the
   * real guard.
   */
  const occurredRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    occurredRef.current?.setAttribute("max", localDateTimeInputMax());
  }, []);

  const vehicleItems = useMemo(
    () =>
      (vehicles.data ?? []).map((row) => ({
        value: row.id,
        label: [row.plate, row.model].filter(Boolean).join(" · "),
        hint: [row.driver_name, row.company_name].filter(Boolean).join(" · ") || undefined,
        keywords: [row.plate, row.model, row.driver_name, row.employee_id, row.company_name]
          .filter(Boolean)
          .join(" ")
          .split(" "),
      })),
    [vehicles.data],
  );

  const selectedVehicle = (vehicles.data ?? []).find((row) => row.id === vehicleId) ?? null;
  const replacementExpected = REPLACEMENT_CASE_STATUSES.includes(
    vehicleCaseStatus as (typeof VEHICLE_CASE_STATUSES)[number],
  );

  const input = (): AccidentInput => ({
    vehicleId,
    occurredAt,
    locationText,
    locationLat: lat.trim() === "" ? null : Number(lat),
    locationLng: lng.trim() === "" ? null : Number(lng),
    driverFault,
    caseStatus,
    vehicleCaseStatus,
    insuranceCompany,
    insuranceClaimStatus,
    policeReportStatus,
    amountKwd: amountKwd.trim() === "" ? null : Number(amountKwd),
    otherPartyName,
    otherPartyPlate,
    otherPartyPhone,
    description,
    fleetComment,
    replacementPlate,
    severity,
    notes: accident?.notes ?? "",
    attachmentKeys: attachments.map((attachment) => attachment.key),
  });

  async function submit() {
    setSaving(true);
    const result = accident
      ? await updateAccident(accident.id, input())
      : await createAccident(input());
    setSaving(false);
    if ("error" in result) {
      toast.error(t(accidentErrorKey(result.error)));
      return;
    }
    toast.success(editing ? t("saved") : t("created"));
    void queryClient.invalidateQueries({ queryKey: queryKeys.accidents.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
    const id = "id" in result ? result.id : accident?.id;
    router.push(id ? `/fleet/accident/${id}` : "/fleet/accident");
    router.refresh();
  }

  async function removeAttachment(key: string) {
    if (accident) {
      const result = await removeAccidentAttachment(accident.id, key);
      if ("error" in result) {
        toast.error(t(accidentErrorKey(result.error)));
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.accidents.all() });
    }
    setAttachments((current) => current.filter((entry) => entry.key !== key));
  }


  return (
    <AppPage className="space-y-4">
      <AppPageHeader
        title={editing ? t("form.titleEdit") : t("form.titleNew")}
        description={editing ? accident?.reference ?? t("form.subtitleEdit") : t("form.subtitleNew")}
        breadcrumbs={[
          { label: t("title"), href: "/fleet/accident" },
          { label: editing ? accident?.reference ?? t("form.titleEdit") : t("form.titleNew") },
        ]}
      />

      <AppFormSection title={t("form.sectionIncident")} description={t("form.sectionIncidentHint")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("cols.vehicle")}</span>
            <SearchSelect
              items={vehicleItems}
              value={vehicleId || null}
              onChange={(next) => setVehicleId(next ?? "")}
              placeholder={t("form.selectVehicle")}
              searchPlaceholder={t("form.searchVehicle")}
              emptyText={t("form.noVehicle")}
              disabled={editing}
            />
            <span className="block text-[10px] text-muted-foreground">{t("form.vehicleHint")}</span>
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("cols.driver")}</span>
            <Input
              className="h-9"
              readOnly
              value={
                accident
                  ? [accident.driver_name, accident.employee_id].filter(Boolean).join(" · ")
                  : [selectedVehicle?.driver_name, selectedVehicle?.employee_id]
                      .filter(Boolean)
                      .join(" · ")
              }
              placeholder={t("form.noDriver")}
            />
            <span className="block text-[10px] text-muted-foreground">{t("form.snapshotHint")}</span>
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("cols.date")}</span>
            <Input
              ref={occurredRef}
              type="datetime-local"
              className="h-9"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
            />
            <span className="block text-[10px] text-muted-foreground">{t("form.dateHint")}</span>
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">
              {t("cols.location")}
              <span className="text-destructive"> *</span>
            </span>
            <Input
              className="h-9"
              maxLength={240}
              value={locationText}
              onChange={(event) => setLocationText(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("form.latitude")}</span>
            <Input
              type="number"
              step="0.000001"
              className="h-9 tabular-nums"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("form.longitude")}</span>
            <Input
              type="number"
              step="0.000001"
              className="h-9 tabular-nums"
              value={lng}
              onChange={(event) => setLng(event.target.value)}
            />
          </label>
        </div>
      </AppFormSection>


      <AppFormSection title={t("form.sectionOtherParty")} description={t("form.sectionOtherPartyHint")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("cols.otherParty")}</span>
            <Input
              className="h-9"
              maxLength={120}
              value={otherPartyName}
              onChange={(event) => setOtherPartyName(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("form.otherPartyPlate")}</span>
            <Input
              className="h-9"
              maxLength={40}
              value={otherPartyPlate}
              onChange={(event) => setOtherPartyPlate(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("form.otherPartyPhone")}</span>
            <Input
              className="h-9 tabular-nums"
              inputMode="tel"
              maxLength={40}
              value={otherPartyPhone}
              onChange={(event) => setOtherPartyPhone(event.target.value)}
            />
            <span className="block text-[10px] text-muted-foreground">{t("form.phoneHint")}</span>
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("cols.insuranceCompany")}</span>
            <Input
              className="h-9"
              maxLength={120}
              value={insuranceCompany}
              onChange={(event) => setInsuranceCompany(event.target.value)}
            />
          </label>
          <div className="w-full space-y-1 text-xs">
            <span className="block font-medium">{t("cols.insuranceClaim")}</span>
            <Select
              items={[
                { value: "any", label: t("filters.any") },
                ...INSURANCE_CLAIM_STATUSES.map((key) => ({ value: key, label: tClaim(key) })),
              ]}
              value={insuranceClaimStatus || "any"}
              onValueChange={(value) => setInsuranceClaimStatus(value === "any" ? "" : value ?? "")}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder={t("filters.any")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t("filters.any")}</SelectItem>
                {INSURANCE_CLAIM_STATUSES.map((key) => (
                  <SelectItem key={key} value={key}>
                    {tClaim(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full space-y-1 text-xs">
            <span className="block font-medium">{t("cols.policeReport")}</span>
            <Select
              items={[
                { value: "any", label: t("filters.any") },
                ...POLICE_REPORT_STATUSES.map((key) => ({ value: key, label: tPolice(key) })),
              ]}
              value={policeReportStatus || "any"}
              onValueChange={(value) => setPoliceReportStatus(value === "any" ? "" : value ?? "")}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder={t("filters.any")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t("filters.any")}</SelectItem>
                {POLICE_REPORT_STATUSES.map((key) => (
                  <SelectItem key={key} value={key}>
                    {tPolice(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("form.amount")}</span>
            <Input
              type="number"
              min={0}
              step="0.001"
              className="h-9 tabular-nums"
              value={amountKwd}
              onChange={(event) => setAmountKwd(event.target.value)}
            />
          </label>
        </div>
      </AppFormSection>


      <AppFormSection title={t("form.sectionCase")} description={t("form.sectionCaseHint")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 text-xs">
            <span className="block font-medium">{t("cols.case")}</span>
            <Select
              items={ACCIDENT_CASE_STATUSES.map((key) => ({ value: key, label: tCase(key) }))}
              value={caseStatus}
              onValueChange={(value) => setCaseStatus(value ?? "pending")}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder={tCase("pending")} />
              </SelectTrigger>
              <SelectContent>
                {ACCIDENT_CASE_STATUSES.map((key) => (
                  <SelectItem key={key} value={key}>
                    {tCase(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 text-xs">
            <span className="block font-medium">{t("cols.driverFault")}</span>
            <Select
              items={[
                { value: "unknown", label: t("filters.any") },
                ...DRIVER_FAULT_VALUES.map((key) => ({ value: key, label: tFault(key) })),
              ]}
              value={driverFault || "unknown"}
              onValueChange={(value) => setDriverFault(value === "unknown" ? "" : value ?? "")}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder={t("filters.any")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">{t("filters.any")}</SelectItem>
                {DRIVER_FAULT_VALUES.map((key) => (
                  <SelectItem key={key} value={key}>
                    {tFault(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 text-xs">
            <span className="block font-medium">{t("cols.vehicleCase")}</span>
            <Select
              items={[
                { value: "none", label: t("filters.any") },
                ...VEHICLE_CASE_STATUSES.map((key) => ({ value: key, label: tVehicleCase(key) })),
              ]}
              value={vehicleCaseStatus || "none"}
              onValueChange={(value) => setVehicleCaseStatus(value === "none" ? "" : value ?? "")}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder={t("filters.any")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("filters.any")}</SelectItem>
                {VEHICLE_CASE_STATUSES.map((key) => (
                  <SelectItem key={key} value={key}>
                    {tVehicleCase(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {replacementExpected ? (
              <span className="block text-[10px] text-muted-foreground">
                {t("form.vehicleCaseHint")}
              </span>
            ) : null}
          </div>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">
              {t("form.replacementPlate")}
              {replacementExpected ? <span className="text-destructive"> *</span> : null}
            </span>
            <Input
              className="h-9"
              maxLength={40}
              value={replacementPlate}
              onChange={(event) => setReplacementPlate(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="block font-medium">{t("form.description")}</span>
            <Textarea
              className="min-h-[64px]"
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="block font-medium">{t("cols.fleetComment")}</span>
            <Textarea
              className="min-h-[56px]"
              maxLength={600}
              value={fleetComment}
              onChange={(event) => setFleetComment(event.target.value)}
            />
          </label>
          <div className="space-y-1 text-xs">
            <span className="block font-medium">{t("form.severity")}</span>
            <Select
              items={[
                { value: "none", label: t("filters.any") },
                { value: "low", label: t("severity.low") },
                { value: "medium", label: t("severity.medium") },
                { value: "high", label: t("severity.high") },
              ]}
              value={severity || "none"}
              onValueChange={(value) => setSeverity(value === "none" ? "" : value ?? "")}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder={t("filters.any")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("filters.any")}</SelectItem>
                <SelectItem value="low">{t("severity.low")}</SelectItem>
                <SelectItem value="medium">{t("severity.medium")}</SelectItem>
                <SelectItem value="high">{t("severity.high")}</SelectItem>
              </SelectContent>
            </Select>
            <span className="block text-[10px] text-muted-foreground">{t("form.severityHint")}</span>
          </div>
        </div>
      </AppFormSection>


      <AppFormSection title={t("form.sectionAttachments")} description={t("form.sectionAttachmentsHint")}>
        <AccidentAttachments
          vehicleId={vehicleId}
          attachments={attachments}
          canManage={canManage}
          busy={saving}
          onAdded={(attachment) => setAttachments((current) => [...current, attachment])}
          onRemove={(key) => void removeAttachment(key)}
        />
      </AppFormSection>

      <AppModalFooter
        asPage
        title={editing ? t("form.footerEdit") : t("form.footerNew")}
        subtitle={t("form.footerHint")}
      >
        <Button
          type="button"
          variant="outline"
          className="h-9"
          onClick={() => router.push(accident ? `/fleet/accident/${accident.id}` : "/fleet/accident")}
        >
          {t("actions.cancel")}
        </Button>
        <Button
          type="button"
          className="h-9"
          disabled={saving || !canManage}
          onClick={() => void submit()}
        >
          {t("actions.save")}
        </Button>
      </AppModalFooter>
    </AppPage>
  );
}

