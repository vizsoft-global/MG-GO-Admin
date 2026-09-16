"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Car, Package, RotateCcw, User } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/dashboard/status-pill";
import { SectionHeading } from "@/features/drivers/form/driver-form-primitives";
import { FleetAttachmentRow } from "@/features/fleet/fleet-attachment-row";
import { ProjectBadge } from "@/features/fleet/fleet-badges";
import { FleetDetailRow, FleetRecordDialog } from "@/features/fleet/fleet-record-dialog";
import { isDriverProjectKey, toKuwaitYmd } from "@/features/fleet/fleet-labels";
import { fetchRequestAttachmentUrl } from "@/features/requests/requests-actions";
import { formatKuwaitDayLabel } from "@/lib/date/kuwait-dates";
import { ASSET_ASSIGNMENT_ATTACHMENT_KINDS, type FleetAssetAssignmentRow } from "./types";

export function AssetAssignmentDialog({
  open,
  row,
  onOpenChange,
}: {
  open: boolean;
  row: FleetAssetAssignmentRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.assets");
  if (!row) return null;

  const byKind = new Map(row.attachments.map((item) => [item.kind, item]));
  const returned = row.status === "returned";

  const openAttachment = async (storageKey: string) => {
    if (!storageKey) return;
    const result = await fetchRequestAttachmentUrl(storageKey);
    if (!result.url) {
      toast.error(result.error ?? t("attachmentOpenFailed"));
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
          title={`${row.asset_code} — ${row.asset_name}`}
          subtitle={`${t("assignedTo")} ${row.driver_name}`}
        >
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </AppModalFooter>
      }
    >
      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <div className="flex h-full flex-col rounded-xl border border-border bg-card p-3 shadow-sm">
          <SectionHeading icon={User} accent="primary">
            {t("sectionEmployee")}
          </SectionHeading>
          <div className="mt-1">
            <FleetDetailRow label={t("colEmployee")}>{row.driver_name}</FleetDetailRow>
            <FleetDetailRow label={t("fieldEmployeeId")}>{row.employee_id ?? "—"}</FleetDetailRow>
            <FleetDetailRow label={t("fieldPhone")}>{row.phone ?? "—"}</FleetDetailRow>
            <FleetDetailRow label={t("colEmpCompany")}>{row.employee_company ?? "—"}</FleetDetailRow>
            <FleetDetailRow label={t("colProject")}>
              <ProjectBadge value={isDriverProjectKey(row.project_key) ? row.project_key : null} />
            </FleetDetailRow>
            <FleetDetailRow label={t("colZone")}>{row.zone ?? "—"}</FleetDetailRow>
          </div>
        </div>
        <div className="flex h-full flex-col rounded-xl border border-border bg-card p-3 shadow-sm">
          <SectionHeading icon={Car} accent="primary">
            {t("sectionVehicle")}
          </SectionHeading>
          <div className="mt-1">
            <FleetDetailRow label={t("colPlate")}>{row.plate ?? "—"}</FleetDetailRow>
            <FleetDetailRow label={t("fieldModel")}>{row.vehicle_model ?? "—"}</FleetDetailRow>
            <FleetDetailRow label={t("colVehicleCompany")}>{row.vehicle_company ?? "—"}</FleetDetailRow>
          </div>
          <SectionHeading icon={RotateCcw} accent="warning">
            {t("sectionReturn")}
          </SectionHeading>
          <div className="mt-1">
            <FleetDetailRow label={t("fieldReturnDate")}>
              {row.returned_at ? formatKuwaitDayLabel(toKuwaitYmd(row.returned_at)) : "—"}
            </FleetDetailRow>
            <FleetDetailRow label={t("fieldReturnedBy")}>{row.returned_by_name ?? "—"}</FleetDetailRow>
            <FleetDetailRow label={t("fieldReturnReason")}>{row.return_reason ?? "—"}</FleetDetailRow>
          </div>
        </div>
        <div className="flex h-full flex-col rounded-xl border border-border bg-card p-3 shadow-sm">
          <SectionHeading icon={Package} accent="primary">
            {t("sectionAsset")}
          </SectionHeading>
          <div className="mt-1">
            <FleetDetailRow label={t("colAssetId")}>{row.asset_code}</FleetDetailRow>
            <FleetDetailRow label={t("colAssetName")}>{row.asset_name}</FleetDetailRow>
            <FleetDetailRow label={t("fieldReceivedAt")}>{row.received_at_place ?? "—"}</FleetDetailRow>
            <FleetDetailRow label={t("fieldReceivedBy")}>{row.received_by_name ?? "—"}</FleetDetailRow>
            <FleetDetailRow label={t("fieldReceivedDate")}>
              {row.assigned_at ? formatKuwaitDayLabel(toKuwaitYmd(row.assigned_at)) : "—"}
            </FleetDetailRow>
            <FleetDetailRow label={t("colStatus")}>
              <StatusPill dot variant={returned ? "neutral" : "success"}>
                {returned ? t("statusReturned") : t("statusAssigned")}
              </StatusPill>
            </FleetDetailRow>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <FleetDetailRow label={t("fieldEvidence")}>
          <div className="grid gap-2 sm:grid-cols-2">
            {ASSET_ASSIGNMENT_ATTACHMENT_KINDS.map((kind) => {
              const found = byKind.get(kind);
              const receiveKind = kind === "receive_form" || kind === "receive_photo";
              const storageKey = found?.storage_key?.trim() ?? "";
              return (
                <FleetAttachmentRow
                  key={kind}
                  title={t(`assignmentAttachment.${kind}`)}
                  fileName={found?.file_name ?? (receiveKind && !returned ? t("notReturned") : null)}
                  capturedAt={found?.captured_at ?? null}
                  source={found?.source ?? null}
                  onOpen={storageKey ? () => void openAttachment(storageKey) : undefined}
                />
              );
            })}
          </div>
        </FleetDetailRow>
      </div>
    </FleetRecordDialog>
  );
}
