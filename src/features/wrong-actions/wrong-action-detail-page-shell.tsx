"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { WrongActionFormDialog } from "./wrong-action-form-dialog";
import { deleteWrongAction } from "./wrong-actions-actions";
import type { WrongActionDriverOption } from "./wrong-actions-actions";
import { formatKuwait, severityTone } from "./wrong-actions-page-shell";
import { WRONG_ACTION_SEVERITY_WEIGHT, type WrongActionRow } from "./types";

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}

export function WrongActionDetailPageShell({
  incident,
  drivers,
  editOpen,
}: {
  incident: WrongActionRow;
  drivers: WrongActionDriverOption[];
  editOpen: boolean;
}) {
  const t = useTranslations("pages.wrongActions");
  const { can } = useAuth();
  const canManage = can("wrong_actions.manage");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <AppPage>
      <AppPageHeader
        title={incident.driver_name ?? t("title")}
        description={t("detailSubtitle")}
        actions={
          canManage ? (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="h-9 cursor-pointer rounded-lg text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="me-2 h-3.5 w-3.5" />
                {t("delete")}
              </Button>
              <Button
                className="h-9 cursor-pointer rounded-lg"
                onClick={() => router.push(`/wrong-actions/${incident.id}?edit=1`)}
              >
                <Pencil className="me-2 h-3.5 w-3.5" />
                {t("edit")}
              </Button>
            </div>
          ) : null
        }
      />
      <Card className="rounded-xl border-border shadow-sm">
        <CardContent className="p-4">
          <DetailRow label={t("colDriver")}>
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded px-1 text-primary hover:bg-primary/10"
              onClick={() => router.push(`/drivers/${incident.driver_id}`)}
            >
              {incident.driver_name ?? "—"}
              {incident.driver_code ? ` · ${incident.driver_code}` : ""}
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </DetailRow>
          <DetailRow label={t("colZone")}>{incident.driver_zone_name ?? "—"}</DetailRow>
          <DetailRow label={t("colType")}>
            {t(`type.${incident.action_type}` as "type.delay")}
          </DetailRow>
          <DetailRow label={t("colSeverity")}>
            <span className="inline-flex items-center gap-2">
              <Badge variant={severityTone(incident.severity)}>
                {t(`severity.${incident.severity}` as "severity.low")}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {t("severityWeightHint", {
                  weight: WRONG_ACTION_SEVERITY_WEIGHT[incident.severity],
                })}
              </span>
            </span>
          </DetailRow>
          <DetailRow label={t("colDate")}>{formatKuwait(incident.occurred_at)}</DetailRow>
          <DetailRow label={t("colSource")}>
            {t(`source.${incident.source}` as "source.admin")}
          </DetailRow>
          <DetailRow label={t("colRecordedBy")}>
            {incident.created_by_name ?? t("recordedBySystem")}
          </DetailRow>
          <DetailRow label={t("colRecordedAt")}>{formatKuwait(incident.created_at)}</DetailRow>
          <DetailRow label={t("fieldDetails")}>
            <p className="whitespace-pre-wrap">{incident.details ?? "—"}</p>
          </DetailRow>
        </CardContent>
      </Card>

      <WrongActionFormDialog
        open={editOpen && canManage}
        incident={incident}
        drivers={drivers}
        driversLoading={false}
        onOpenChange={(open) => {
          if (!open) router.replace(`/wrong-actions/${incident.id}`);
        }}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.wrongActions.all() });
          void queryClient.invalidateQueries({ queryKey: queryKeys.performance.all() });
          router.replace(`/wrong-actions/${incident.id}`);
          router.refresh();
        }}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          showCloseButton
          closeOutside
          className="w-[min(520px,94vw)] overflow-visible px-5 py-4"
        >
          <div className="space-y-3 pt-4">
            <p className="text-sm text-muted-foreground">{t("deleteConfirm")}</p>
            <AppModalFooter title={t("deleteTitle")} subtitle={t("deleteSubtitle")}>
              <Button
                type="button"
                variant="outline"
                className="h-9"
                onClick={() => setConfirmOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="h-9"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const result = await deleteWrongAction(incident.id);
                    if (result.error) {
                      toast.error(
                        t(`errors.${result.error}` as "errors.save_failed"),
                      );
                      return;
                    }
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.wrongActions.all(),
                    });
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.performance.all(),
                    });
                    toast.success(t("deleted"));
                    setConfirmOpen(false);
                    router.replace("/wrong-actions");
                  });
                }}
              >
                <Trash2 className="me-2 h-3.5 w-3.5" />
                {t("delete")}
              </Button>
            </AppModalFooter>
          </div>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
