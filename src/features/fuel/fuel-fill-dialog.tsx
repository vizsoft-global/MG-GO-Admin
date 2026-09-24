"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Car, Fuel, MapPin } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/features/drivers/form/driver-form-primitives";
import { FleetAttachmentRow } from "@/features/fleet/fleet-attachment-row";
import { FleetRecordDialog } from "@/features/fleet/fleet-record-dialog";
import { FuelCompanyBadge, FuelTypeBadge, ProjectBadge } from "@/features/fleet/fleet-badges";
import { fuelPaymentLabel } from "@/features/fleet/fleet-labels";
import { formatKuwaitDayLabel } from "@/lib/date/kuwait-dates";
import { fetchFuelFillAttachmentUrl } from "./fuel-actions";
import { FuelFillMap } from "./fuel-fill-map";
import { formatKwd } from "./fuel-week";
import type { FuelWeekRow } from "./types";

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3 py-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="min-w-0 text-sm font-medium">{value}</div>
    </div>
  );
}

const ATTACHMENT_ORDER = ["fuel_receipt", "fuel_pump", "odometer"] as const;

function fuelLogSubtitle(
  row: FuelWeekRow,
  t: ReturnType<typeof useTranslations<"pages.fuel">>,
): string {
  const fuelType =
    row.fuelType === "card" ? t("fuelCard") : row.fuelType === "chip" ? t("chip") : "—";
  const company = row.fuelCompany ? row.fuelCompany.toUpperCase() : "—";
  return `${row.plate ?? "—"} — ${fuelType} ${row.chip ?? "—"} · Company ${company}`;
}

export function FuelFillDialog({
  open,
  row,
  weekDays,
  onOpenChange,
}: {
  open: boolean;
  row: FuelWeekRow | null;
  weekDays: string[];
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.fuel");
  if (!row) return null;

  const remaining = Math.max(0, row.monthlyLimit - row.withdrawn);
  const latest = row.fills[row.fills.length - 1] ?? null;
  const attachments = latest?.attachments ?? [];
  const weekEntries = weekDays.flatMap((day, index) => {
    const cell = row.days[index];
    if (!cell) return [];
    return [{ day, ...cell }];
  });

  const openAttachment = async (storageKey: string) => {
    if (!storageKey) return;
    const result = await fetchFuelFillAttachmentUrl(storageKey);
    if (!result.url) {
      toast.error(result.error ?? "Could not open attachment");
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  return (
    <FleetRecordDialog
      open={open}
      onOpenChange={onOpenChange}
      footer={
        <AppModalFooter
          title={`${t("logTitle")} — ${row.driverName ?? row.plate ?? "—"}`}
          subtitle={fuelLogSubtitle(row, t)}
        >
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </AppModalFooter>
      }
    >
      <div className="grid gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs sm:grid-cols-3">
        <span className="min-w-0">
          {t("monthlyLimit")}: <strong>{formatKwd(row.monthlyLimit)} KWD</strong>
        </span>
        <span className={row.critical ? "min-w-0 font-semibold text-destructive" : "min-w-0"}>
          {t("withdrawn")}: <strong>{formatKwd(row.withdrawn)} KWD</strong>
        </span>
        <span className="min-w-0">
          {t("remaining")}: <strong>{formatKwd(remaining)} KWD</strong>
        </span>
      </div>

      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
          <SectionHeading icon={Car} accent="primary">
            {t("sectionDriverVehicle")}
          </SectionHeading>
          <div className="mt-2">
            <DetailRow label={t("colEmployee")} value={row.driverName ?? "—"} />
            <DetailRow label={t("fieldEmployeeId")} value={row.employeeId ?? "—"} />
            <DetailRow label={t("colEmpCompany")} value={row.employeeCompany ?? "—"} />
            <DetailRow label={t("colPlate")} value={row.plate ?? "—"} />
            <DetailRow label={t("fieldModel")} value={row.model ?? "—"} />
            <DetailRow label={t("colCarsCompany")} value={row.vehicleCompany ?? "—"} />
            <DetailRow label={t("colFuelType")} value={<FuelTypeBadge value={row.fuelType} />} />
            <DetailRow label={t("paymentMethod")} value={fuelPaymentLabel(row.fuelType) ?? "—"} />
            <DetailRow label={t("colChip")} value={row.chip ?? "—"} />
            <DetailRow label={t("colFuelCompany")} value={<FuelCompanyBadge value={row.fuelCompany} />} />
            <DetailRow label={t("colProject")} value={<ProjectBadge value={row.projectKey} />} />
            <DetailRow label={t("colZone")} value={row.zone ?? "—"} />
          </div>
        </div>

        <div className="flex h-full min-h-0 flex-col gap-2">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <SectionHeading icon={Fuel} accent="success">
              {t("sectionWeekEntries")}
            </SectionHeading>
            <div className="mt-2">
              {weekEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("noEntries")}</p>
              ) : (
                weekEntries.map((entry) => (
                  <DetailRow
                    key={entry.day}
                    label={formatKuwaitDayLabel(entry.day)}
                    value={`${formatKwd(entry.costKwd)} KWD · ${entry.litres.toFixed(1)}L · ${entry.stationName || "—"}`}
                  />
                ))
              )}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <SectionHeading icon={Fuel} accent="success">
              {t("sectionAttachments")}
            </SectionHeading>
            <div className="mt-2 space-y-2">
              {ATTACHMENT_ORDER.map((kind) => {
                const attachment = attachments.find((item) => item.kind === kind);
                return (
                  <FleetAttachmentRow
                    key={kind}
                    title={t(`attachment.${kind}`)}
                    fileName={attachment?.file_name}
                    capturedAt={attachment?.captured_at}
                    source={attachment?.source}
                    onOpen={
                      attachment?.storage_key
                        ? () => void openAttachment(attachment.storage_key)
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </div>
          {latest?.lat != null && latest.lng != null ? (
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <SectionHeading icon={MapPin} accent="warning">
                {t("sectionMap")}
              </SectionHeading>
              <div className="mt-2">
                <FuelFillMap lat={latest.lat} lng={latest.lng} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </FleetRecordDialog>
  );
}
