"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppFormSection } from "@/components/app/app-form-section";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { formatKwd } from "@/lib/format/money";
import {
  effectiveRecordCost,
  isTerminalStage,
  nextStageOptions,
  partsTotal,
  recordDay,
  recordStage,
} from "./service-records-model";
import { categoryTone } from "./service-types";
import { ServiceAttachments } from "./service-attachments";
import { setServiceStage } from "./service-actions";
import { serviceErrorKey } from "./use-service";
import type { ServiceRecordRow, ServiceStage } from "./types";

function kwd(value: number | null): string {
  return formatKwd(value);
}

export function ServiceRecordDetail({
  record,
  canManage,
}: {
  record: ServiceRecordRow;
  canManage: boolean;
}) {
  const t = useTranslations("pages.fleetService");
  const tStage = useTranslations("pages.fleetService.stages");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ServiceStage | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const stage = recordStage(record);
  const plate = record.vehicle_snapshot?.plate ?? "—";

  async function applyStage(next: ServiceStage, reason: string) {
    setSaving(true);
    const result = await setServiceStage({ id: record.id, stage: next, note: reason });
    setSaving(false);
    if ("error" in result) {
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(t("stageChanged", { stage: tStage(next) }));
    setPending(null);
    setNote("");
    void queryClient.invalidateQueries({ queryKey: queryKeys.service.all() });
    router.refresh();
  }

  function move(next: ServiceStage) {
    if (next === "cancelled") {
      setPending(next);
      return;
    }
    void applyStage(next, "");
  }

  const rows: { label: string; value: string }[] = [
    { label: t("detail.serviceType"), value: record.service_type_label ?? record.kind ?? "—" },
    { label: t("detail.description"), value: record.description ?? "—" },
    { label: t("cols.date"), value: recordDay(record) || "—" },
    { label: t("detail.driver"), value: record.driver_name ?? "—" },
    { label: t("detail.employeeId"), value: record.employee_id ?? "—" },
    { label: t("detail.invoiceNo"), value: record.invoice_no ?? "—" },
    { label: t("detail.invoiceDate"), value: record.invoice_date ?? "—" },
    { label: t("cols.company"), value: record.company ?? "—" },
    { label: t("cols.vendor"), value: record.vendor ?? "—" },
    { label: t("cols.cost"), value: kwd(effectiveRecordCost(record)) },
    { label: t("cols.odometer"), value: String(record.odometer_km ?? record.odometer ?? "—") },
  ];

  return (
    <AppPage className="space-y-4">
      <AppPageHeader
        title={`${plate} · ${record.service_type_label ?? record.kind ?? "—"}`}
        breadcrumbs={[{ label: t("title"), href: "/fleet/service" }, { label: tStage(stage) }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {tStage(stage)}
            </Badge>
            {record.category ? (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${categoryTone(record.category)}`}
              >
                {t(`categories.${record.category}`)}
              </span>
            ) : null}
            {record.vehicle_snapshot?.model ? <span>{record.vehicle_snapshot.model}</span> : null}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManage && !isTerminalStage(stage)
              ? nextStageOptions(stage).map((next) => (
                  <Button
                    key={next}
                    type="button"
                    variant={next === "cancelled" ? "outline" : "default"}
                    className="h-9"
                    disabled={saving}
                    onClick={() => move(next)}
                  >
                    {t("actions.moveTo", { stage: tStage(next) })}
                  </Button>
                ))
              : null}
            {canManage ? (
              <Button
                type="button"
                variant="outline"
                className="h-9"
                render={<Link href={`/fleet/service/records/${record.id}?edit=1`} />}
              >
                {t("actions.edit")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => router.push("/fleet/service")}
            >
              {t("actions.back")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <AppFormSection title={t("detail.summary")}>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
                <dd className="truncate">{row.value}</dd>
              </div>
            ))}
          </dl>
        </AppFormSection>

        <AppFormSection
          title={t("detail.parts")}
          description={t("detail.partsTotal", { total: kwd(partsTotal(record.parts)) })}
        >
          {record.parts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("detail.noParts")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-1 text-start font-bold">{t("form.partName")}</th>
                  <th className="pb-1 text-end font-bold">{t("form.partQty")}</th>
                  <th className="pb-1 text-end font-bold">{t("form.partUnit")}</th>
                  <th className="pb-1 text-end font-bold">{t("form.partTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {record.parts.map((part, index) => (
                  <tr key={`${part.name}-${index}`} className="border-t border-border">
                    <td className="py-1.5">{part.name}</td>
                    <td className="py-1.5 text-end tabular-nums">{part.qty}</td>
                    <td className="py-1.5 text-end tabular-nums">
                      {kwd(part.unit_cost_kwd)}
                    </td>
                    <td className="py-1.5 text-end tabular-nums">{kwd(part.total_kwd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AppFormSection>
      </div>

      <AppFormSection title={t("detail.attachments")} description={t("detail.attachmentsHint")}>
        <ServiceAttachments
          vehicleId={record.vehicle_id}
          attachments={record.attachments}
          canManage={false}
          onChange={() => undefined}
        />
      </AppFormSection>

      <AppFormSection title={t("detail.history")}>
        {record.stage_history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("detail.noHistory")}</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {record.stage_history.map((event, index) => (
              <li key={`${event.stage}-${index}`} className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {tStage(event.stage)}
                </Badge>
                <span className="tabular-nums text-muted-foreground">
                  {event.at.slice(0, 16).replace("T", " ")}
                </span>
                <span>{event.by_name ?? "—"}</span>
                {event.note ? <span className="text-muted-foreground">· {event.note}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </AppFormSection>

      <Dialog open={pending !== null} onOpenChange={(open) => (open ? null : setPending(null))}>
        <DialogContent showCloseButton closeOutside className="w-[min(440px,96vw)]">
          <div className="space-y-2 px-5 pt-4 pb-2">
            <label className="space-y-1 text-xs">
              <span className="block font-medium">{t("actions.cancelReason")}</span>
              <Input
                className="h-9"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("actions.cancelReasonPlaceholder")}
              />
            </label>
          </div>
          <AppModalFooter title={t("actions.moveTo", { stage: tStage("cancelled") })}>
            <Button type="button" variant="outline" className="h-9" onClick={() => setPending(null)}>
              {t("actions.cancel")}
            </Button>
            <Button
              type="button"
              className="h-9"
              disabled={saving || !note.trim()}
              onClick={() => void applyStage("cancelled", note)}
            >
              {t("actions.save")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
