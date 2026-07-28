"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DriverDocumentUpload } from "@/features/drivers/driver-document-upload";
import {
  DocumentExpiryFields,
  mergeDocumentExpiry,
} from "@/features/drivers/document-expiry-fields";
import { EMPTY_DOCUMENT_EXPIRY, type DocumentExpiryConfig } from "@/features/drivers/types";
import type { DocumentExpiryRow } from "./document-expiry-utils";

export function DocumentExpiryUpdateSheet({
  open,
  mode,
  row,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  mode: "date" | "replace" | null;
  row: DocumentExpiryRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations("pages.documentExpiry");
  const tDocs = useTranslations("pages.driverNew.documents");
  const [expiry, setExpiry] = useState<DocumentExpiryConfig>({ ...EMPTY_DOCUMENT_EXPIRY });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!row) return;
    setExpiry(
      mergeDocumentExpiry({
        trackExpiry: true,
        expiresAt: row.expiresAt,
        notifyEnabled: row.notifyEnabled,
        notifyLeadDays: row.notifyLeadDays,
        objectKey: row.objectKey,
      }),
    );
  }, [row]);

  const saveDate = async () => {
    if (!row?.intakeId) return;
    if (expiry.trackExpiry && !expiry.expiresAt) {
      toast.error(t("dateRequired"));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/admin/driver-documents/expiry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intakeId: row.intakeId,
          driverProfileId: row.driverId,
          docType: row.docType,
          trackExpiry: expiry.trackExpiry,
          expiresAt: expiry.expiresAt,
          notifyEnabled: expiry.notifyEnabled,
          notifyLeadDays: expiry.notifyLeadDays,
        }),
      });
      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        toast.error(t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
      onSaved();
      onOpenChange(false);
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[92vh] w-[min(720px,96vw)] flex-col gap-0 overflow-visible rounded-xl p-0"
        showCloseButton
        closeOutside
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-3">
          {mode === "replace" && row.intakeId ? (
            <DriverDocumentUpload
              mode="remote"
              variant="card"
              docType={row.docType}
              intakeId={row.intakeId}
              driverProfileId={row.driverId}
              existing={
                row.objectKey
                  ? {
                      objectKey: row.objectKey,
                      signedUrl: "#",
                      sizeBytes: null,
                      contentType: null,
                      source: row.driverId ? "driver" : "intake",
                      expiry,
                    }
                  : null
              }
              expiry={expiry}
              onExpiryChange={setExpiry}
              onChanged={() => {
                toast.success(t("saved"));
                onSaved();
                onOpenChange(false);
              }}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("updateDateFor", {
                  driver: row.driverName,
                  document: tDocs(row.docType),
                })}
              </p>
              <DocumentExpiryFields value={expiry} onChange={setExpiry} disabled={saving} />
            </div>
          )}
        </div>
        {mode === "date" ? (
          <AppModalFooter title={t("sheet.updateDateTitle")} subtitle={tDocs(row.docType)}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer rounded-md"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 cursor-pointer rounded-md px-4"
              disabled={saving}
              onClick={() => void saveDate()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
            </Button>
          </AppModalFooter>
        ) : (
          <AppModalFooter title={t("sheet.replaceTitle")} subtitle={tDocs(row.docType)}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer rounded-md"
              onClick={() => onOpenChange(false)}
            >
              {t("close")}
            </Button>
          </AppModalFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
