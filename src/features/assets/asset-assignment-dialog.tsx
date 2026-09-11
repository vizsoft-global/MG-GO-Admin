"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Car, FileText, Package, RotateCcw, User } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SectionHeading } from "@/features/drivers/form/driver-form-primitives";
import { FleetAttachmentRow } from "@/features/fleet/fleet-attachment-row";
import { ProjectBadge } from "@/features/fleet/fleet-badges";
import { isDriverProjectKey, toKuwaitYmd } from "@/features/fleet/fleet-labels";
import { formatKuwaitDayLabel } from "@/lib/date/kuwait-dates";
import { ASSET_ASSIGNMENT_ATTACHMENT_KINDS, type FleetAssetAssignmentRow } from "./types";

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3 py-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="min-w-0 text-sm font-medium">{value}</div>
    </div>
  );
}

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        closeOutside
        className="w-[min(1200px,96vw)] overflow-visible px-5 py-4"
      >
        <div className="space-y-2 pt-4">
          <div className="grid gap-2 lg:grid-cols-3 lg:items-stretch">
            <div className="flex h-full flex-col rounded-xl border border-border bg-card p-3 shadow-sm">
              <SectionHeading icon={User} accent="primary">
                {t("sectionEmployee")}
              </SectionHeading>
              <div className="mt-1">
                <DetailRow label={t("colEmployee")} value={row.driver_name} />
                <DetailRow label={t("fieldEmployeeId")} value={row.employee_id ?? "—"} />
                <DetailRow label={t("fieldPhone")} value={row.phone ?? "—"} />
                <DetailRow label={t("colEmpCompany")} value={row.employee_company ?? "—"} />
                <DetailRow
                  label={t("colProject")}
                  value={<ProjectBadge value={isDriverProjectKey(row.project_key) ? row.project_key : null} />}
                />
                <DetailRow label={t("colZone")} value={row.zone ?? "—"} />
              </div>
            </div>
            <div className="flex h-full flex-col rounded-xl border border-border bg-card p-3 shadow-sm">
              <SectionHeading icon={Car} accent="primary">
                {t("sectionVehicle")}
              </SectionHeading>
              <div className="mt-1">
                <DetailRow label={t("colPlate")} value={row.plate ?? "—"} />
                <DetailRow label={t("fieldModel")} value={row.vehicle_model ?? "—"} />
                <DetailRow label={t("colVehicleCompany")} value={row.vehicle_company ?? "—"} />
              </div>
              <SectionHeading icon={RotateCcw} accent="warning">
                {t("sectionReturn")}
              </SectionHeading>
              <div className="mt-1">
                <DetailRow
                  label={t("fieldReturnDate")}
                  value={row.returned_at ? formatKuwaitDayLabel(toKuwaitYmd(row.returned_at)) : "—"}
                />
                <DetailRow label={t("fieldReturnedBy")} value={row.returned_by_name ?? "—"} />
                <DetailRow label={t("fieldReturnReason")} value={row.return_reason ?? "—"} />
              </div>
            </div>
            <div className="flex h-full flex-col rounded-xl border border-border bg-card p-3 shadow-sm">
              <SectionHeading icon={Package} accent="primary">
                {t("sectionAsset")}
              </SectionHeading>
              <div className="mt-1">
                <DetailRow label={t("colAssetId")} value={row.asset_code} />
                <DetailRow label={t("colAssetName")} value={row.asset_name} />
                <DetailRow label={t("fieldReceivedAt")} value={row.received_at_place ?? "—"} />
                <DetailRow label={t("fieldReceivedBy")} value={row.received_by_name ?? "—"} />
                <DetailRow
                  label={t("fieldReceivedDate")}
                  value={row.assigned_at ? formatKuwaitDayLabel(toKuwaitYmd(row.assigned_at)) : "—"}
                />
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <SectionHeading icon={FileText} accent="success">
              {t("sectionAttachments")}
            </SectionHeading>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {ASSET_ASSIGNMENT_ATTACHMENT_KINDS.map((kind) => {
                const found = byKind.get(kind);
                const receiveKind = kind === "receive_form" || kind === "receive_photo";
                return (
                  <FleetAttachmentRow
                    key={kind}
                    title={t(`assignmentAttachment.${kind}`)}
                    fileName={found?.file_name ?? (receiveKind && !returned ? t("notReturned") : null)}
                    capturedAt={found?.captured_at ?? null}
                    source={found?.source ?? null}
                  />
                );
              })}
            </div>
          </div>
        </div>
        <AppModalFooter
          title={`${row.asset_code} — ${row.asset_name}`}
          subtitle={`${t("assignedTo")} ${row.driver_name}`}
        >
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
