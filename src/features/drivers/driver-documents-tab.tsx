"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/dashboard/status-pill";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { DOCUMENT_TYPES, type DriverRemoteDocument } from "./types";
import { daysUntilExpiry } from "@/features/document-expiry/document-expiry-utils";
import { useDriverDocuments } from "./use-drivers";

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function contentTypeFromKey(key: string): string | null {
  const ext = key.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return null;
}

function isImageDocument(doc: DriverRemoteDocument): boolean {
  const ct = doc.contentType ?? contentTypeFromKey(doc.objectKey);
  return Boolean(ct?.startsWith("image/"));
}

function basenameFromKey(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] ?? key;
}

function DocumentCard({
  doc,
  label,
  viewLabel,
  previewLabel,
  notUploadedLabel,
  expiryLabel,
}: {
  doc: DriverRemoteDocument | undefined;
  label: string;
  viewLabel: string;
  previewLabel: string;
  notUploadedLabel: string;
  expiryLabel?: (days: number) => string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const isImage = doc ? isImageDocument(doc) : false;
  const expiryDays =
    doc?.expiry?.trackExpiry && doc.expiry.expiresAt
      ? daysUntilExpiry(doc.expiry.expiresAt)
      : null;

  if (!doc) {
    return (
      <div className="flex min-h-[10rem] flex-col rounded-xl border border-dashed border-border bg-muted/15 px-4 py-4">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-auto text-xs text-muted-foreground">{notUploadedLabel}</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-[10rem] flex-col rounded-xl border border-border bg-card px-3 py-3 shadow-sm">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">
          {formatFileSize(doc.sizeBytes)}
        </p>
        {expiryDays != null ? (
          <StatusPill
            variant={expiryDays < 0 ? "danger" : expiryDays <= 7 ? "warning" : "success"}
            className="mt-1"
          >
            {expiryLabel
              ? expiryLabel(expiryDays)
              : `${doc.expiry?.expiresAt ?? ""}${expiryDays < 0 ? "" : ` · ${expiryDays}d`}`}
          </StatusPill>
        ) : null}

        <div className="mt-2 flex flex-1 flex-col gap-2">
          {isImage ? (
            <button
              type="button"
              className="group relative aspect-[4/3] w-full cursor-pointer overflow-hidden rounded-lg border border-border bg-muted"
              onClick={() => setPreviewOpen(true)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={doc.signedUrl}
                alt=""
                className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-2 py-1.5 text-start text-[10px] font-medium text-white">
                {previewLabel}
              </span>
            </button>
          ) : (
            <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/40">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <span className="max-w-full truncate px-2 text-center text-[10px] text-muted-foreground">
                {basenameFromKey(doc.objectKey)}
              </span>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full cursor-pointer rounded-lg text-xs"
            nativeButton={false}
            render={
              <a href={doc.signedUrl} target="_blank" rel="noopener noreferrer" />
            }
          >
            <ExternalLink className="me-1.5 h-3.5 w-3.5" />
            {viewLabel}
          </Button>
        </div>
      </div>

      {isImage ? (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-[min(92vw,720px)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="border-b border-border px-4 py-3">
              <DialogTitle className="text-sm font-semibold">{label}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[min(80vh,640px)] overflow-auto bg-muted/30 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={doc.signedUrl}
                alt=""
                className="mx-auto max-h-[min(78vh,600px)] w-auto max-w-full rounded-md object-contain"
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function DriverDocumentsTab({
  intakeId,
  profileId,
  onEdit,
  canManage,
}: {
  intakeId: string | null;
  profileId: string | null;
  onEdit?: () => void;
  canManage?: boolean;
}) {
  const t = useTranslations("pages.driverDetail");
  const tNew = useTranslations("pages.driverNew");
  const tExpiry = useTranslations("pages.documentExpiry.status");
  const { data: documents = {}, isLoading } = useDriverDocuments(
    intakeId ?? "",
    profileId,
    Boolean(intakeId),
  );

  if (isLoading) {
    return (
      <Card className="rounded-xl border-border shadow-sm">
        <CardContent className="flex min-h-[240px] items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const uploadedCount = DOCUMENT_TYPES.filter((docType) => documents[docType]).length;

  if (uploadedCount === 0) {
    return (
      <Card className="rounded-xl border-border shadow-sm">
        <CardContent className="py-12">
          <AppEmptyState
            title={t("documentsEmptyTitle")}
            description={t("documentsEmptyDescription")}
          />
          {canManage && onEdit && intakeId ? (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="cursor-pointer rounded-lg"
                onClick={onEdit}
              >
                {t("documentsUploadViaEdit")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border-border shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border py-4">
        <div>
          <CardTitle className="text-base font-semibold">
            {t("documentsTabTitle")}
          </CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("documentsTabSummary", { count: uploadedCount })}
          </p>
        </div>
        {canManage && onEdit && intakeId ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer rounded-lg"
            onClick={onEdit}
          >
            {t("documentsManage")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="py-4">
        <div
          className={cn(
            "grid gap-3",
            "sm:grid-cols-2",
            uploadedCount >= 3 && "lg:grid-cols-2",
          )}
        >
          {DOCUMENT_TYPES.map((docType) => (
            <DocumentCard
              key={docType}
              doc={documents[docType]}
              label={tNew(`documents.${docType}`)}
              viewLabel={t("viewDocument")}
              previewLabel={t("previewDocument")}
              notUploadedLabel={t("documentsNotUploaded")}
              expiryLabel={(days) =>
                days < 0
                  ? tExpiry("expired", { days: Math.abs(days) })
                  : tExpiry("daysLeft", { days })
              }
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
