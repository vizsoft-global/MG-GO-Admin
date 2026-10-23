"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/dashboard/status-pill";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DOCUMENT_TYPES, type DriverRemoteDocument } from "./types";
import { daysUntilExpiry } from "@/features/document-expiry/document-expiry-utils";
import { useDriverDocuments } from "./use-drivers";
import { DriverExtraDocuments } from "./driver-extra-documents";
import { DriverDocumentUpload } from "./driver-document-upload";
import { queryKeys } from "@/lib/query/query-keys";

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

const DOC_GRID =
  "grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 min-[900px]:grid-cols-3";

function DocumentCard({
  doc,
  label,
  viewLabel,
  previewLabel,
  notUploadedLabel,
  uploadedLabel,
  expiryLabel,
}: {
  doc: DriverRemoteDocument | undefined;
  label: string;
  viewLabel: string;
  previewLabel: string;
  notUploadedLabel: string;
  uploadedLabel: string;
  expiryLabel?: (days: number) => string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const isImage = doc ? isImageDocument(doc) : false;
  const expiryDays =
    doc?.expiry?.trackExpiry && doc.expiry.expiresAt
      ? daysUntilExpiry(doc.expiry.expiresAt)
      : null;

  return (
    <>
      <div className="flex flex-col gap-3.5 rounded-[14px] border border-border bg-card p-[18px]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#F7E9E4] text-sidebar-primary">
              <FileText className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <h3 className="truncate text-sm font-semibold text-foreground">{label}</h3>
          </div>
          <span
            className={
              doc
                ? "shrink-0 rounded-full bg-[#E3F1E6] px-2.5 py-[3px] text-xs font-semibold text-[#1F5C2E]"
                : "shrink-0 rounded-full bg-[#FCEFD9] px-2.5 py-[3px] text-xs font-semibold text-[#7A4A00]"
            }
          >
            {doc ? uploadedLabel : notUploadedLabel}
          </span>
        </div>
        {expiryDays != null ? (
          <StatusPill
            variant={expiryDays < 0 ? "danger" : expiryDays <= 7 ? "warning" : "success"}
          >
            {expiryLabel
              ? expiryLabel(expiryDays)
              : `${doc?.expiry?.expiresAt ?? ""}${expiryDays < 0 ? "" : ` · ${expiryDays}d`}`}
          </StatusPill>
        ) : null}

        {doc ? (
          <div className="flex flex-col gap-2.5">
            {isImage ? (
              <button
                type="button"
                className="flex cursor-pointer flex-col gap-0.5 rounded-[10px] border border-border bg-[#F2F2F5] px-3.5 py-3 text-start break-all"
                onClick={() => setPreviewOpen(true)}
              >
                <strong className="text-sm font-semibold text-foreground">
                  {basenameFromKey(doc.objectKey)}
                </strong>
                <span className="text-sm text-muted-foreground">
                  {formatFileSize(doc.sizeBytes)} · {previewLabel}
                </span>
              </button>
            ) : (
              <div className="flex flex-col gap-0.5 rounded-[10px] border border-border bg-[#F2F2F5] px-3.5 py-3 break-all">
                <strong className="text-sm font-semibold text-foreground">
                  {basenameFromKey(doc.objectKey)}
                </strong>
                <span className="text-sm text-muted-foreground">
                  {formatFileSize(doc.sizeBytes)}
                </span>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              className="h-10 min-h-10 w-fit cursor-pointer rounded-lg px-3.5"
              nativeButton={false}
              render={
                <a href={doc.signedUrl} target="_blank" rel="noopener noreferrer" />
              }
            >
              <ExternalLink className="me-1.5 h-3.5 w-3.5" />
              {viewLabel}
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-col items-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed border-[#D7D7DF] bg-[#F7F6F4] px-3.5 py-[22px] text-center">
            <FileText className="h-[22px] w-[22px] text-sidebar-primary" aria-hidden />
            <strong className="font-semibold text-[#292A3F]">{label}</strong>
            <span className="text-sm text-muted-foreground">{notUploadedLabel}</span>
          </div>
        )}
      </div>

      {doc && isImage ? (
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
  const queryClient = useQueryClient();
  const { data: documents = {}, isLoading } = useDriverDocuments(
    intakeId ?? "",
    profileId,
    Boolean(intakeId),
  );
  const uploadedLabel = t("documentUploaded", { size: "" }).trim();

  const refreshDocuments = () => {
    if (!intakeId) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.drivers.documents(intakeId, profileId),
    });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">{t("documentsTitle")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("documentsClickToUpload")}
          </p>
        </div>
        {canManage && onEdit && intakeId ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-10 cursor-pointer rounded-lg"
            onClick={onEdit}
          >
            {t("documentsManage")}
          </Button>
        ) : null}
      </div>
      <div className={DOC_GRID}>
        {DOCUMENT_TYPES.map((docType) =>
          canManage && intakeId ? (
            <DriverDocumentUpload
              key={docType}
              variant="card"
              mode="remote"
              docType={docType}
              intakeId={intakeId}
              driverProfileId={profileId}
              existing={documents[docType] ?? null}
              onChanged={() => refreshDocuments()}
            />
          ) : (
            <DocumentCard
              key={docType}
              doc={documents[docType]}
              label={tNew(`documents.${docType}`)}
              viewLabel={t("viewDocument")}
              previewLabel={t("previewDocument")}
              notUploadedLabel={t("documentsNotUploaded")}
              uploadedLabel={uploadedLabel}
              expiryLabel={(days) =>
                days < 0
                  ? tExpiry("expired", { days: Math.abs(days) })
                  : tExpiry("daysLeft", { days })
              }
            />
          ),
        )}
      </div>
      <DriverExtraDocuments
        intakeId={intakeId}
        profileId={profileId}
        canManage={canManage}
      />
    </div>
  );
}
