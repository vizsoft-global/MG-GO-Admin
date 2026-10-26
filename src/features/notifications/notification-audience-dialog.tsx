"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNotificationDispatchItems } from "./use-notifications";

export function CampaignAudienceButton({
  campaignId,
  count,
  title,
  body,
}: {
  campaignId: string;
  count: number;
  title: string;
  body: string;
}) {
  const t = useTranslations("pages.notifications");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="cursor-pointer text-primary hover:underline"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {t("audienceOpen", { count })}
      </button>
      {open ? (
        <AudienceDialog
          campaignId={campaignId}
          audienceCount={count}
          title={title}
          body={body}
          cancelLabel={tCommon("cancel")}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function AudienceDialog({
  campaignId,
  audienceCount,
  title,
  body,
  cancelLabel,
  onClose,
}: {
  campaignId: string;
  audienceCount: number;
  title: string;
  body: string;
  cancelLabel: string;
  onClose: () => void;
}) {
  const t = useTranslations("pages.notifications");
  const itemsQuery = useNotificationDispatchItems(campaignId);
  const loaded = itemsQuery.data;
  const shown = loaded ? loaded.length : audienceCount;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        showCloseButton
        closeOutside
        className="w-[min(1200px,96vw)] max-w-none"
      >
        <div className="max-h-[min(60dvh,520px)] overflow-y-auto px-5 py-4">
          {itemsQuery.isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : itemsQuery.isError ? (
            <p className="text-sm text-muted-foreground">{t("errors.dispatch_failed")}</p>
          ) : loaded && loaded.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("audienceEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colEmployeeId")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colSentTitle")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colSentBody")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(loaded ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.employee_id ?? "—"}</TableCell>
                    <TableCell className="max-w-[240px] whitespace-normal">
                      {item.resolved_title?.trim() || title || "—"}
                    </TableCell>
                    <TableCell className="max-w-[360px] whitespace-normal">
                      {item.resolved_body?.trim() || body || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <div className="px-5 pb-4">
          <AppModalFooter
            title={t("audienceDialogTitle", { count: shown })}
            subtitle={t("audienceDialogSubtitle")}
          >
            <Button type="button" variant="outline" className="h-9" onClick={onClose}>
              {cancelLabel}
            </Button>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
