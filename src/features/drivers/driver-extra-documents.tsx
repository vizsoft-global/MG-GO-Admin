"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryKeys } from "@/lib/query/query-keys";
import { validateDocumentFile } from "./driver-form-validation";
import type { DriverExtraDocument } from "./types";
import { useDriverExtraDocuments } from "./use-drivers";

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadedOn(locale: string, iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function DriverExtraDocuments({
  intakeId,
  profileId,
  canManage,
}: {
  intakeId: string | null;
  profileId: string | null;
  canManage?: boolean;
}) {
  const t = useTranslations("pages.driverDetail");
  const tNew = useTranslations("pages.driverNew");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data: documents = [], isLoading } = useDriverExtraDocuments(
    intakeId ?? "",
    profileId,
    Boolean(intakeId),
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [toDelete, setToDelete] = useState<DriverExtraDocument | null>(null);

  function errorMessage(key: string): string {
    const scoped = `errors.${key}`;
    if (tNew.has(scoped)) return tNew(scoped);
    return tNew("errors.upload_failed");
  }

  function resetDialog() {
    setTitle("");
    setFile(null);
    setErrorKey(null);
    setShowErrors(false);
    setPending(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.drivers.extraDocuments(intakeId ?? "", profileId),
    });
  }

  async function handleUpload() {
    const trimmed = title.trim();
    if (!trimmed || !file) {
      setShowErrors(true);
      setErrorKey(!trimmed ? "extra_document_title_required" : "extra_document_file_required");
      return;
    }
    const fileError = validateDocumentFile(file);
    if (fileError) {
      setErrorKey(fileError);
      setShowErrors(true);
      return;
    }
    if (!intakeId) {
      setErrorKey("save_failed");
      setShowErrors(true);
      return;
    }

    setPending(true);
    setErrorKey(null);
    try {
      const body = new FormData();
      body.append("intakeId", intakeId);
      if (profileId) body.append("driverProfileId", profileId);
      body.append("docType", "extra");
      body.append("title", trimmed);
      body.append("file", file);

      const response = await fetch("/api/admin/driver-documents/upload", {
        method: "POST",
        body,
      });
      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        setErrorKey(json.error ?? "upload_failed");
        setShowErrors(true);
        return;
      }
      setAddOpen(false);
      resetDialog();
      invalidate();
      toast.success(t("extraDocumentAdded"));
    } catch {
      setErrorKey("upload_failed");
      setShowErrors(true);
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!toDelete || !intakeId) return;
    setPending(true);
    try {
      const response = await fetch("/api/admin/driver-documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intakeId,
          driverProfileId: profileId,
          docType: "extra",
          documentId: toDelete.id,
        }),
      });
      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        toast.error(errorMessage(json.error ?? "save_failed"));
        return;
      }
      invalidate();
      toast.success(t("extraDocumentDeleted"));
      setToDelete(null);
    } catch {
      toast.error(errorMessage("delete_failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-[14px] border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-[18px]">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">
            {t("extraDocumentsTitle")}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("extraDocumentsDescription")}
          </p>
        </div>
        {canManage && intakeId ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 min-h-10 cursor-pointer rounded-lg px-3.5"
            onClick={() => {
              resetDialog();
              setAddOpen(true);
            }}
          >
            + {t("extraDocumentAdd")}
          </Button>
        ) : null}
      </div>
      <div>
        {isLoading ? (
          <div className="flex min-h-[96px] items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : documents.length === 0 ? (
          <p className="px-4 py-9 text-center text-sm text-muted-foreground">
            {t("extraDocumentsEmpty")}
          </p>
        ) : (
          <ul>
            {documents.map((doc) => {
              const uploadedOn = formatUploadedOn(locale, doc.uploadedAt);
              return (
                <li key={doc.id} className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-b-0">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#F7E9E4] text-sidebar-primary">
                    <FileText className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {doc.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatFileSize(doc.sizeBytes)}
                      {uploadedOn
                        ? ` · ${t("extraDocumentUploadedOn", { date: uploadedOn })}`
                        : null}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("viewDocument")}
                    className="h-8 w-8 cursor-pointer text-primary hover:bg-primary/10 hover:text-primary"
                    nativeButton={false}
                    render={
                      <a href={doc.signedUrl} target="_blank" rel="noopener noreferrer" />
                    }
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  {canManage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={tCommon("delete")}
                      className="h-8 w-8 cursor-pointer text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setToDelete(doc)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog
        open={addOpen}
        onOpenChange={(next) => {
          if (pending) return;
          if (!next) resetDialog();
          setAddOpen(next);
        }}
      >
        <DialogContent
          className="flex max-w-md flex-col gap-0 overflow-visible rounded-xl p-0"
          showCloseButton={!pending}
          closeOutside
        >
          <div className="space-y-3 px-5 pt-4 pb-2">
            <div className="space-y-1">
              <Label htmlFor="driver-extra-document-title">
                {t("extraDocumentNameLabel")}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="driver-extra-document-title"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (showErrors) setErrorKey(null);
                }}
                placeholder={t("extraDocumentNamePlaceholder")}
                className="h-[42px] min-h-[42px] rounded-lg px-3"
                maxLength={120}
                disabled={pending}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="driver-extra-document-file">
                {t("extraDocumentFileLabel")}
                <span className="text-destructive">*</span>
              </Label>
              <input
                ref={fileInputRef}
                id="driver-extra-document-file"
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const picked = event.target.files?.[0] ?? null;
                  setFile(picked);
                  if (showErrors) setErrorKey(null);
                }}
                disabled={pending}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={pending}
                className="flex min-h-[42px] w-full cursor-pointer items-center gap-2 rounded-lg border-[1.5px] border-dashed border-[#D7D7DF] bg-[#F7F6F4] px-3 py-2.5 text-start hover:border-[#292A3F] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {file ? file.name : t("extraDocumentChooseFile")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {file ? formatFileSize(file.size) : t("extraDocumentFileHint")}
                  </span>
                </span>
              </button>
            </div>
            {showErrors && errorKey ? (
              <p className="text-xs text-destructive">{errorMessage(errorKey)}</p>
            ) : null}
          </div>
          <AppModalFooter
            title={t("extraDocumentAdd")}
            subtitle={t("extraDocumentAddSubtitle")}
          >
            <Button
              type="button"
              variant="outline"
              className="h-10 min-h-10 cursor-pointer rounded-lg"
              onClick={() => {
                resetDialog();
                setAddOpen(false);
              }}
              disabled={pending}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              className="h-10 min-h-10 cursor-pointer rounded-lg bg-[#292A3F] px-4 text-white hover:bg-[#292A3F]/90"
              onClick={() => void handleUpload()}
              disabled={pending}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("extraDocumentUpload")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>

      <SimpleConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(next) => {
          if (!next) setToDelete(null);
        }}
        title={t("extraDocumentDeleteTitle")}
        description={
          toDelete
            ? t("extraDocumentDeleteBody", { title: toDelete.title })
            : t("extraDocumentDeleteTitle")
        }
        confirmLabel={tCommon("delete")}
        onConfirm={handleDelete}
        isPending={pending}
      />
    </section>
  );
}
