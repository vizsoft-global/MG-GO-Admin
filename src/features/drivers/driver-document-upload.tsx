"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { xhrUpload } from "@/lib/http/xhr-upload";
import { isDriverErrorKey } from "./driver-errors";
import { validateDocumentFile } from "./driver-form-validation";
import {
  appendExpiryToFormData,
  DocumentExpiryFields,
  mergeDocumentExpiry,
} from "./document-expiry-fields";
import { ReplaceExpiryPrompt } from "./document-replace-prompt";
import {
  EMPTY_DOCUMENT_EXPIRY,
  type DocumentExpiryConfig,
  type DriverDocumentType,
  type DriverRemoteDocument,
} from "./types";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(contentType: string | null): boolean {
  return Boolean(contentType?.startsWith("image/"));
}

function isImageFile(file: File | null | undefined): boolean {
  return Boolean(file?.type.startsWith("image/"));
}

function basenameFromKey(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] ?? key;
}

function DocumentViewButton({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "h-6 cursor-pointer gap-1 rounded-md px-2 text-[11px] font-medium text-primary hover:bg-primary/10 hover:text-primary",
        className,
      )}
      nativeButton={false}
      render={<a href={href} target="_blank" rel="noopener noreferrer" />}
    >
      <ExternalLink className="h-3 w-3 shrink-0" />
      {label}
    </Button>
  );
}

function DocumentRemoveButton({
  label,
  disabled,
  onClick,
  className,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "h-6 cursor-pointer gap-1 rounded-md px-2 text-[11px] font-medium text-destructive hover:bg-destructive/10 hover:text-destructive",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
    >
      <Trash2 className="h-3 w-3 shrink-0" />
      {label}
    </Button>
  );
}

type UploadResponse = {
  ok?: boolean;
  error?: string;
  objectKey?: string;
  signedUrl?: string;
  sizeBytes?: number | null;
  contentType?: string | null;
  source?: "driver" | "intake";
};

type SharedProps = {
  docType: DriverDocumentType;
  disabled?: boolean;
  error?: string;
  compact?: boolean;
  variant?: "default" | "card";
};

type InlineProps = SharedProps & {
  mode: "inline";
  file: File | null;
  expiry?: DocumentExpiryConfig;
  onChange: (file: File | null) => void;
  onExpiryChange?: (next: DocumentExpiryConfig) => void;
  isSubmitting?: boolean;
};

type RemoteProps = SharedProps & {
  mode: "remote";
  intakeId: string;
  driverProfileId: string | null;
  existing: DriverRemoteDocument | null;
  expiry?: DocumentExpiryConfig;
  onChanged: (next: DriverRemoteDocument | null) => void;
  onExpiryChange?: (next: DocumentExpiryConfig) => void;
};

export type DriverDocumentUploadProps = InlineProps | RemoteProps;

export function DriverDocumentUpload(props: DriverDocumentUploadProps) {
  if (props.variant === "card") {
    if (props.mode === "inline") return <InlineDocumentUploadCard {...props} />;
    return <RemoteDocumentUploadCard {...props} />;
  }
  if (props.mode === "inline") {
    if (props.compact) return <InlineDocumentUploadCompact {...props} />;
    return <InlineDocumentUpload {...props} />;
  }
  if (props.compact) return <RemoteDocumentUploadCompact {...props} />;
  return <RemoteDocumentUpload {...props} />;
}

function InlineDocumentUpload({
  docType,
  file,
  onChange,
  error,
  isSubmitting = false,
  disabled,
}: InlineProps) {
  const t = useTranslations("pages.driverNew");
  const inputRef = useRef<HTMLInputElement>(null);
  const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const label = t(`documents.${docType}`);

  useEffect(() => {
    if (!file || !isImageFile(file)) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const displayError =
    error ??
    (localErrorKey && isDriverErrorKey(localErrorKey)
      ? t(`errors.${localErrorKey}`)
      : localErrorKey
        ? localErrorKey
        : undefined);

  const removeFile = () => {
    onChange(null);
    setLocalErrorKey(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handlePick = (picked: File | null) => {
    if (!picked) return;
    const validationError = validateDocumentFile(picked);
    if (validationError) {
      setLocalErrorKey(validationError);
      return;
    }
    setLocalErrorKey(null);
    onChange(picked);
  };

  const borderClass = displayError
    ? "border-destructive/60 bg-destructive/5"
    : file
      ? "border-primary/30 bg-primary/5"
      : "border-border bg-muted/20";

  return (
    <DocumentSlotShell
      label={label}
      borderClass={borderClass}
      displayError={displayError}
      inputRef={inputRef}
      disabled={disabled || isSubmitting}
      onPick={handlePick}
    >
      {!file ? (
        <EmptyDropzone
          onClick={() => inputRef.current?.click()}
          disabled={disabled || isSubmitting}
          uploadLabel={t("uploadDocument")}
          formatsLabel={t("uploadFormats")}
        />
      ) : (
        <FileCard
          previewUrl={previewUrl}
          isImage={isImageFile(file)}
          name={file.name}
          sizeLabel={formatFileSize(file.size)}
          status={
            isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="text-xs text-primary">{t("documentUploading")}</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="text-xs text-primary">{t("documentSelected")}</span>
              </>
            )
          }
          hint={!isSubmitting ? t("documentPendingHint") : undefined}
          onReplace={() => inputRef.current?.click()}
          replaceLabel={t("replaceDocument")}
          removeLabel={t("removeDocument")}
          onRemove={removeFile}
          removeDisabled={isSubmitting}
        />
      )}
    </DocumentSlotShell>
  );
}

function InlineDocumentUploadCompact({
  docType,
  file,
  onChange,
  error,
  isSubmitting = false,
  disabled,
}: InlineProps) {
  const t = useTranslations("pages.driverNew");
  const inputRef = useRef<HTMLInputElement>(null);
  const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);

  const displayError =
    error ??
    (localErrorKey && isDriverErrorKey(localErrorKey)
      ? t(`errors.${localErrorKey}`)
      : localErrorKey
        ? localErrorKey
        : undefined);

  const label = t(`documents.${docType}`);

  return (
    <div className="space-y-1">
      <div className="flex min-h-9 items-center gap-2 rounded-md border border-border bg-muted/10 px-2.5 py-1.5">
        {isImageFile(file) ? (
          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="w-[120px] shrink-0 truncate text-xs font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {file ? file.name : t("uploadDocument")}
        </span>
        {file ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 cursor-pointer rounded-md px-2 text-xs"
            disabled={disabled || isSubmitting}
            onClick={() => onChange(null)}
          >
            {t("removeDocument")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 cursor-pointer rounded-md px-2 text-xs"
          disabled={disabled || isSubmitting}
          onClick={() => inputRef.current?.click()}
        >
          {file ? t("replaceDocument") : t("uploadDocument")}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={disabled || isSubmitting}
        onChange={(event) => {
          const picked = event.target.files?.[0] ?? null;
          if (!picked) return;
          const validationError = validateDocumentFile(picked);
          if (validationError) {
            setLocalErrorKey(validationError);
            return;
          }
          setLocalErrorKey(null);
          onChange(picked);
        }}
      />
      {displayError ? (
        <p className="text-xs text-destructive" role="alert">
          {displayError}
        </p>
      ) : null}
    </div>
  );
}

function InlineDocumentUploadCard({
  docType,
  file,
  expiry,
  onChange,
  onExpiryChange,
  error,
  isSubmitting = false,
  disabled,
}: InlineProps) {
  const t = useTranslations("pages.driverNew");
  const inputRef = useRef<HTMLInputElement>(null);
  const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);

  const displayError =
    error ??
    (localErrorKey && isDriverErrorKey(localErrorKey)
      ? t(`errors.${localErrorKey}`)
      : localErrorKey
        ? localErrorKey
        : undefined);

  const label = t(`documents.${docType}`);

  return (
    <div
      className={cn(
        "rounded-md border p-2",
        displayError
          ? "border-destructive/60 bg-destructive/5"
          : file
            ? "border-emerald-200 bg-emerald-50/40"
            : "border-border bg-muted/10",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        {isImageFile(file) ? (
          <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <p className="truncate text-xs font-medium text-foreground">{label}</p>
      </div>

      <button
        type="button"
        disabled={disabled || isSubmitting}
        onClick={() => inputRef.current?.click()}
        className="flex h-7 w-full cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-border bg-background text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Upload className="h-3 w-3" />
        {file ? t("replaceDocument") : t("uploadDocument")}
      </button>

      {file ? (
        <div className="mt-1.5 flex items-center justify-between gap-1 rounded border border-emerald-200/80 bg-emerald-50/50 px-1.5 py-1">
          <p className="min-w-0 truncate text-[10px] font-medium text-foreground">{file.name}</p>
          <DocumentRemoveButton
            label={t("removeDocument")}
            disabled={disabled || isSubmitting}
            onClick={() => onChange(null)}
          />
        </div>
      ) : null}

      {file ? (
        <DocumentExpiryFields
          compact
          value={mergeDocumentExpiry(expiry ?? EMPTY_DOCUMENT_EXPIRY)}
          disabled={disabled || isSubmitting}
          onChange={(next) => onExpiryChange?.(next)}
        />
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={disabled || isSubmitting}
        onChange={(event) => {
          const picked = event.target.files?.[0] ?? null;
          if (!picked) return;
          const validationError = validateDocumentFile(picked);
          if (validationError) {
            setLocalErrorKey(validationError);
            return;
          }
          setLocalErrorKey(null);
          onChange(picked);
        }}
      />

      {displayError ? (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {displayError}
        </p>
      ) : null}
    </div>
  );
}

function RemoteDocumentUpload({
  docType,
  intakeId,
  driverProfileId,
  existing: existingProp,
  onChanged,
  error,
  disabled,
}: RemoteProps) {
  const t = useTranslations("pages.driverDetail");
  const tErr = useTranslations("pages.driverNew");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [remote, setRemote] = useState<DriverRemoteDocument | null>(
    existingProp,
  );
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  useEffect(() => {
    setRemote(existingProp);
  }, [existingProp]);

  const label = tErr(`documents.${docType}`);

  const displayError =
    error ??
    (localErrorKey && isDriverErrorKey(localErrorKey)
      ? tErr(`errors.${localErrorKey}`)
      : localErrorKey
        ? localErrorKey
        : failed
          ? t("uploadFailed")
          : undefined);

  const busy = uploading || removing || disabled;

  const uploadFile = async (file: File) => {
    const validationError = validateDocumentFile(file);
    if (validationError) {
      setLocalErrorKey(validationError);
      setFailed(false);
      return;
    }

    setLocalErrorKey(null);
    setFailed(false);
    setUploading(true);
    setProgress(0);

    if (isImageFile(file)) {
      const url = URL.createObjectURL(file);
      setLocalPreview(url);
    } else {
      setLocalPreview(null);
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const body = new FormData();
    body.append("intakeId", intakeId);
    if (driverProfileId) body.append("driverProfileId", driverProfileId);
    body.append("docType", docType);
    body.append("file", file);

    try {
      const { status, json } = await xhrUpload<UploadResponse>({
        url: "/api/admin/driver-documents/upload",
        formData: body,
        signal: controller.signal,
        onProgress: (p) => setProgress(p.percent),
      });

      if (status < 200 || status >= 300 || !json.ok) {
        setFailed(true);
        setLocalErrorKey(json.error ?? "upload_failed");
        return;
      }

      const next: DriverRemoteDocument = {
        objectKey: json.objectKey!,
        signedUrl: json.signedUrl!,
        sizeBytes: json.sizeBytes ?? file.size,
        contentType: json.contentType ?? file.type,
        source: json.source ?? "intake",
      };
      setRemote(next);
      setProgress(100);
      onChanged(next);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setFailed(true);
      setLocalErrorKey("upload_failed");
    } finally {
      setUploading(false);
      setLocalPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setLocalErrorKey(null);
    setFailed(false);
    try {
      const res = await fetch("/api/admin/driver-documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intakeId,
          driverProfileId: driverProfileId ?? undefined,
          docType,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setLocalErrorKey(
          json.error && isDriverErrorKey(json.error)
            ? json.error
            : "save_failed",
        );
        return;
      }
      setRemote(null);
      onChanged(null);
    } catch {
      setLocalErrorKey("save_failed");
    } finally {
      setRemoving(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const borderClass = displayError
    ? "border-destructive/60 bg-destructive/5"
    : remote
      ? "border-primary/30 bg-primary/5"
      : "border-border bg-muted/20";

  const showRemote = remote && !uploading;
  const previewUrl =
    localPreview ??
    (showRemote && isImageMime(remote.contentType) ? remote.signedUrl : null);

  return (
    <DocumentSlotShell
      label={label}
      borderClass={borderClass}
      displayError={displayError}
      inputRef={inputRef}
      disabled={busy}
      onPick={(f) => void uploadFile(f!)}
    >
      {uploading ? (
        <div className={cn("rounded-lg border p-3", borderClass)}>
          <p className="mb-2 text-xs font-medium text-foreground">
            {t("uploadProgress", { pct: progress })}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {tErr("documentUploading")}
          </p>
        </div>
      ) : !showRemote ? (
        failed ? (
          <div className="space-y-2">
            <EmptyDropzone
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              uploadLabel={tErr("uploadDocument")}
              formatsLabel={tErr("uploadFormats")}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full cursor-pointer rounded-lg text-xs"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <RefreshCw className="me-1.5 h-3.5 w-3.5" />
              {t("tryAgain")}
            </Button>
          </div>
        ) : (
          <EmptyDropzone
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            uploadLabel={tErr("uploadDocument")}
            formatsLabel={tErr("uploadFormats")}
          />
        )
      ) : (
        <FileCard
          previewUrl={previewUrl}
          isImage={Boolean(previewUrl)}
          name={basenameFromKey(remote.objectKey)}
          sizeLabel={sizeLabelFromRemote(remote, t)}
          status={
            removing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {t("removingDocument")}
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="text-xs text-primary">
                  {sizeLabelFromRemote(remote, t)}
                </span>
              </>
            )
          }
          viewHref={remote.signedUrl}
          viewLabel={t("viewDocument")}
          onReplace={() => inputRef.current?.click()}
          replaceLabel={tErr("replaceDocument")}
          removeLabel={tErr("removeDocument")}
          onRemove={() => void handleRemove()}
          removeDisabled={busy}
        />
      )}
    </DocumentSlotShell>
  );
}

function RemoteDocumentUploadCompact({
  docType,
  intakeId,
  driverProfileId,
  existing,
  onChanged,
  error,
  disabled,
}: RemoteProps) {
  const t = useTranslations("pages.driverDetail");
  const tErr = useTranslations("pages.driverNew");
  const inputRef = useRef<HTMLInputElement>(null);
  const [remote, setRemote] = useState<DriverRemoteDocument | null>(existing);
  const [busy, setBusy] = useState(false);
  const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);

  useEffect(() => setRemote(existing), [existing]);

  const displayError =
    error ??
    (localErrorKey && isDriverErrorKey(localErrorKey)
      ? tErr(`errors.${localErrorKey}`)
      : localErrorKey
        ? localErrorKey
        : undefined);

  const uploadFile = async (file: File) => {
    const validationError = validateDocumentFile(file);
    if (validationError) {
      setLocalErrorKey(validationError);
      return;
    }

    const body = new FormData();
    body.append("intakeId", intakeId);
    if (driverProfileId) body.append("driverProfileId", driverProfileId);
    body.append("docType", docType);
    body.append("file", file);

    setBusy(true);
    setLocalErrorKey(null);
    try {
      const response = await fetch("/api/admin/driver-documents/upload", {
        method: "POST",
        body,
      });
      const json = (await response.json()) as UploadResponse;
      if (!response.ok || !json.ok || !json.objectKey || !json.signedUrl) {
        setLocalErrorKey(json.error ?? "upload_failed");
        return;
      }
      const next: DriverRemoteDocument = {
        objectKey: json.objectKey,
        signedUrl: json.signedUrl,
        sizeBytes: json.sizeBytes ?? null,
        contentType: json.contentType ?? file.type,
        source: json.source ?? "intake",
      };
      setRemote(next);
      onChanged(next);
    } catch {
      setLocalErrorKey("upload_failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeRemote = async () => {
    setBusy(true);
    setLocalErrorKey(null);
    try {
      const response = await fetch("/api/admin/driver-documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intakeId,
          driverProfileId: driverProfileId ?? undefined,
          docType,
        }),
      });
      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        setLocalErrorKey(json.error ?? "save_failed");
        return;
      }
      setRemote(null);
      onChanged(null);
    } catch {
      setLocalErrorKey("save_failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex min-h-9 items-center gap-2 rounded-md border border-border bg-muted/10 px-2.5 py-1.5">
        {isImageMime(remote?.contentType ?? null) ? (
          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="w-[120px] shrink-0 truncate text-xs font-medium">{tErr(`documents.${docType}`)}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {remote ? basenameFromKey(remote.objectKey) : tErr("uploadDocument")}
        </span>
        {remote ? (
          <>
            <DocumentViewButton href={remote.signedUrl} label={t("viewDocument")} className="h-7" />
            <DocumentRemoveButton
              label={tErr("removeDocument")}
              disabled={disabled || busy}
              onClick={() => void removeRemote()}
              className="h-7"
            />
          </>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 cursor-pointer rounded-md px-2 text-xs"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          {remote ? tErr("replaceDocument") : tErr("uploadDocument")}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          if (!file) return;
          void uploadFile(file);
        }}
      />
      {displayError ? (
        <p className="text-xs text-destructive" role="alert">
          {displayError}
        </p>
      ) : null}
    </div>
  );
}

function RemoteDocumentUploadCard({
  docType,
  intakeId,
  driverProfileId,
  existing,
  expiry,
  onChanged,
  onExpiryChange,
  error,
  disabled,
}: RemoteProps) {
  const t = useTranslations("pages.driverDetail");
  const tErr = useTranslations("pages.driverNew");
  const tExpiry = useTranslations("pages.driverNew.documentExpiry");
  const inputRef = useRef<HTMLInputElement>(null);
  const [remote, setRemote] = useState<DriverRemoteDocument | null>(existing);
  const [busy, setBusy] = useState(false);
  const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);
  const [replacePromptOpen, setReplacePromptOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => setRemote(existing), [existing]);

  const displayError =
    error ??
    (localErrorKey && isDriverErrorKey(localErrorKey)
      ? tErr(`errors.${localErrorKey}`)
      : localErrorKey
        ? localErrorKey
        : undefined);

  const resolvedExpiry = expiry ?? mergeDocumentExpiry(existing?.expiry);

  const persistExpiry = async (nextExpiry: DocumentExpiryConfig) => {
    if (!remote) return;
    const response = await fetch("/api/admin/driver-documents/expiry", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intakeId,
        driverProfileId,
        docType,
        trackExpiry: nextExpiry.trackExpiry,
        expiresAt: nextExpiry.expiresAt,
        notifyEnabled: nextExpiry.notifyEnabled,
        notifyLeadDays: nextExpiry.notifyLeadDays,
      }),
    });
    const json = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !json.ok) {
      setLocalErrorKey(json.error ?? "save_failed");
      return;
    }
    onChanged({ ...remote, expiry: nextExpiry });
  };

  const uploadFile = async (file: File, expiryOverride?: DocumentExpiryConfig) => {
    const validationError = validateDocumentFile(file);
    if (validationError) {
      setLocalErrorKey(validationError);
      return;
    }

    const activeExpiry = expiryOverride ?? resolvedExpiry;
    if (activeExpiry.trackExpiry && !activeExpiry.expiresAt) {
      setLocalErrorKey("expiry_date_required");
      return;
    }

    const body = new FormData();
    body.append("intakeId", intakeId);
    if (driverProfileId) body.append("driverProfileId", driverProfileId);
    body.append("docType", docType);
    body.append("file", file);
    appendExpiryToFormData(body, docType, activeExpiry);

    setBusy(true);
    setLocalErrorKey(null);
    try {
      const response = await fetch("/api/admin/driver-documents/upload", {
        method: "POST",
        body,
      });
      const json = (await response.json()) as UploadResponse;
      if (!response.ok || !json.ok || !json.objectKey || !json.signedUrl) {
        setLocalErrorKey(json.error ?? "upload_failed");
        return;
      }
      const next: DriverRemoteDocument = {
        objectKey: json.objectKey,
        signedUrl: json.signedUrl,
        sizeBytes: json.sizeBytes ?? null,
        contentType: json.contentType ?? file.type,
        source: json.source ?? "intake",
        expiry: activeExpiry,
      };
      setRemote(next);
      onExpiryChange?.(activeExpiry);
      onChanged(next);
    } catch {
      setLocalErrorKey("upload_failed");
    } finally {
      setBusy(false);
      setPendingFile(null);
      setReplacePromptOpen(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleFilePick = (file: File) => {
    if (remote && resolvedExpiry.trackExpiry) {
      setPendingFile(file);
      setReplacePromptOpen(true);
      return;
    }
    void uploadFile(file);
  };

  const removeRemote = async () => {
    setBusy(true);
    setLocalErrorKey(null);
    try {
      const response = await fetch("/api/admin/driver-documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intakeId,
          driverProfileId: driverProfileId ?? undefined,
          docType,
        }),
      });
      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        setLocalErrorKey(json.error ?? "save_failed");
        return;
      }
      setRemote(null);
      onChanged(null);
    } catch {
      setLocalErrorKey("save_failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-md border p-2",
        displayError
          ? "border-destructive/60 bg-destructive/5"
          : remote
            ? "border-emerald-200 bg-emerald-50/40"
            : "border-border bg-muted/10",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        {isImageMime(remote?.contentType ?? null) ? (
          <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <p className="truncate text-xs font-medium text-foreground">{tErr(`documents.${docType}`)}</p>
      </div>

      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className="flex h-7 w-full cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-border bg-background text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Upload className="h-3 w-3" />
        {remote ? tErr("replaceDocument") : tErr("uploadDocument")}
      </button>

      {remote ? (
        <div className="mt-1.5 space-y-1 rounded border border-emerald-200/80 bg-emerald-50/50 px-1.5 py-1">
          <p className="truncate text-[10px] font-medium text-foreground">
            {basenameFromKey(remote.objectKey)}
          </p>
          <div className="flex items-center gap-1">
            <DocumentViewButton href={remote.signedUrl} label={t("viewDocument")} />
            <DocumentRemoveButton
              label={tErr("removeDocument")}
              disabled={disabled || busy}
              onClick={() => void removeRemote()}
            />
          </div>
        </div>
      ) : null}

      {remote ? (
        <DocumentExpiryFields
          compact
          value={mergeDocumentExpiry(resolvedExpiry)}
          disabled={disabled || busy}
          onChange={(next) => {
            onExpiryChange?.(next);
            void persistExpiry(next);
          }}
        />
      ) : null}

      <ReplaceExpiryPrompt
        open={replacePromptOpen}
        currentExpiry={resolvedExpiry}
        labels={{
          title: tExpiry("replacePrompt"),
          keepDate: tExpiry("keepCurrentDate"),
          updateDate: tExpiry("updateDate"),
          cancel: tExpiry("cancelReplace"),
          expiresOn: tExpiry("expiresOn"),
          confirm: tExpiry("updateDate"),
        }}
        onCancel={() => {
          setReplacePromptOpen(false);
          setPendingFile(null);
          if (inputRef.current) inputRef.current.value = "";
        }}
        onKeepDate={() => {
          if (pendingFile) void uploadFile(pendingFile, resolvedExpiry);
        }}
        onUpdateDate={(expiresAt) => {
          if (!pendingFile) return;
          const nextExpiry = { ...resolvedExpiry, trackExpiry: true, expiresAt };
          onExpiryChange?.(nextExpiry);
          void uploadFile(pendingFile, nextExpiry);
        }}
      />

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          if (!file) return;
          handleFilePick(file);
        }}
      />

      {displayError ? (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {displayError}
        </p>
      ) : null}
    </div>
  );
}

function sizeLabelFromRemote(
  remote: DriverRemoteDocument,
  t: ReturnType<typeof useTranslations<"pages.driverDetail">>,
): string {
  const size =
    remote.sizeBytes != null ? formatFileSize(remote.sizeBytes) : "—";
  return t("documentUploaded", { size });
}

function DocumentSlotShell({
  label,
  borderClass,
  displayError,
  inputRef,
  disabled,
  onPick,
  children,
}: {
  label: string;
  borderClass: string;
  displayError?: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  onPick: (file: File | null) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground">{label}</p>
      {children}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={disabled}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      {displayError ? (
        <p className="text-xs text-destructive" role="alert">
          {displayError}
        </p>
      ) : null}
    </div>
  );
}

function EmptyDropzone({
  onClick,
  disabled,
  uploadLabel,
  formatsLabel,
}: {
  onClick: () => void;
  disabled?: boolean;
  uploadLabel: string;
  formatsLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-[6.5rem] w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-4 transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50",
        "border-border bg-muted/20",
      )}
    >
      <Upload className="h-4 w-4 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{uploadLabel}</span>
      <span className="text-[10px] text-muted-foreground">{formatsLabel}</span>
    </button>
  );
}

function FileCard({
  previewUrl,
  isImage,
  name,
  sizeLabel,
  status,
  hint,
  viewHref,
  viewLabel,
  onReplace,
  replaceLabel,
  removeLabel,
  onRemove,
  removeDisabled,
}: {
  previewUrl: string | null;
  isImage: boolean;
  name: string;
  sizeLabel: string;
  status: React.ReactNode;
  hint?: string;
  viewHref?: string;
  viewLabel?: string;
  onReplace: () => void;
  replaceLabel: string;
  removeLabel: string;
  onRemove: () => void;
  removeDisabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/10 p-2.5">
      <div className="flex items-start gap-2.5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
          {previewUrl && isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : isImage ? (
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">{status}</div>
          {hint ? (
            <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 cursor-pointer text-destructive hover:text-destructive"
          disabled={removeDisabled}
          onClick={onRemove}
          aria-label={removeLabel}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {viewHref && viewLabel ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 cursor-pointer rounded-md px-2 text-xs"
            nativeButton={false}
            render={
              <a href={viewHref} target="_blank" rel="noopener noreferrer" />
            }
          >
            <ExternalLink className="me-1 h-3 w-3" />
            {viewLabel}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 cursor-pointer rounded-md px-2 text-xs"
          disabled={removeDisabled}
          onClick={onReplace}
        >
          {replaceLabel}
        </Button>
      </div>
    </div>
  );
}
