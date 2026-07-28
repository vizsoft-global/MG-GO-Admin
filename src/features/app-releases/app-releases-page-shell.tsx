"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getAppReleaseDownloadUrl } from "./app-releases-actions";
import { AppReleasesAdoptionPanel } from "./app-releases-adoption-panel";
import {
  uploadAppReleaseWithProgress,
  type AppReleaseUploadProgress,
} from "./app-release-upload-client";
import { useAppReleaseMutations, useAppReleasesList } from "./use-app-releases";
import type { AppReleaseChannel, AppReleaseRow } from "./types";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortSha256(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}

export function AppReleasesPageShell() {
  const t = useTranslations("pages.appReleases");
  const [channel, setChannel] = useState<AppReleaseChannel>("production");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AppReleaseRow | null>(null);
  const [isConfiguringCors, setIsConfiguringCors] = useState(false);

  const { data: items = [], isLoading, refetch, isFetching } = useAppReleasesList(channel);
  const { activate, markRequired, remove } = useAppReleaseMutations(channel);
  const channelLabel = t(`channels.${channel}`);

  const latestVersionCode = useMemo(
    () => (items.length > 0 ? Math.max(...items.map((row) => row.version_code)) : 0),
    [items],
  );

  const handleActivate = (id: string) => {
    activate.mutate(id, {
      onSuccess: () => toast.success(t("toasts.activated")),
      onError: (error) => toast.error(t(`errors.${error.message}`, { defaultValue: error.message })),
    });
  };

  const handleRequiredToggle = (row: AppReleaseRow, required: boolean) => {
    markRequired.mutate(
      { id: row.id, required },
      {
        onSuccess: () =>
          toast.success(required ? t("toasts.markedRequired") : t("toasts.markedOptional")),
        onError: (error) =>
          toast.error(t(`errors.${error.message}`, { defaultValue: error.message })),
      },
    );
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    remove.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success(t("toasts.deleted"));
        setDeleteTarget(null);
      },
      onError: (error) =>
        toast.error(t(`errors.${error.message}`, { defaultValue: error.message })),
    });
  };

  const handleDownload = async (id: string) => {
    const result = await getAppReleaseDownloadUrl(id);
    if (!result.ok) {
      toast.error(t(`errors.${result.error}`, { defaultValue: result.error }));
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  const isBusy =
    activate.isPending ||
    markRequired.isPending ||
    remove.isPending ||
    isFetching;

  const handleConfigureCors = async () => {
    setIsConfiguringCors(true);
    try {
      const extraOrigins = typeof window !== "undefined" ? [window.location.origin] : [];
      const response = await fetch("/api/admin/app-releases/setup-cors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origins: extraOrigins }),
      });
      const json = (await response.json()) as
        | { ok: true; appliedOrigins: string[] }
        | { ok: false; error: string; details?: string };
      if (!response.ok || !json.ok) {
        const message = !json.ok
          ? t(`errors.${json.error}`, { defaultValue: json.error })
          : t("errors.upload_failed");
        const details = !json.ok && json.details ? ` — ${json.details}` : "";
        toast.error(`${message}${details}`);
        return;
      }
      toast.success(t("toasts.corsConfigured"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      toast.error(`${t("errors.upload_failed")} — ${message}`);
    } finally {
      setIsConfiguringCors(false);
    }
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={channel}
              onValueChange={(value) => setChannel(value as AppReleaseChannel)}
            >
              <SelectTrigger className="h-9 w-[160px] rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="production">{t("channels.production")}</SelectItem>
                <SelectItem value="beta">{t("channels.beta")}</SelectItem>
                <SelectItem value="internal">{t("channels.internal")}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer rounded-lg"
              onClick={() => void refetch()}
              disabled={isBusy}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("refresh")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer rounded-lg"
              onClick={() => void handleConfigureCors()}
              disabled={isConfiguringCors}
              title={t("configureStorageHint")}
            >
              {isConfiguringCors ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <SettingsIcon className="mr-2 h-4 w-4" />
              )}
              {t("configureStorage")}
            </Button>
            <Button
              size="sm"
              className="h-9 cursor-pointer rounded-lg"
              onClick={() => setUploadOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("uploadButton")}
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="releases" className="space-y-4">
        <TabsList className="rounded-xl bg-muted/50 p-1">
          <TabsTrigger value="releases" className="cursor-pointer rounded-lg">
            {t("tabs.releases")}
          </TabsTrigger>
          <TabsTrigger value="adoption" className="cursor-pointer rounded-lg">
            {t("tabs.adoption")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="releases">
          <AppListCard title={t("listTitle", { channel: channelLabel })}>
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.version")}</TableHead>
                    <TableHead>{t("columns.released")}</TableHead>
                    <TableHead>{t("columns.size")}</TableHead>
                    <TableHead>{t("columns.sha256")}</TableHead>
                    <TableHead>{t("columns.required")}</TableHead>
                    <TableHead>{t("columns.status")}</TableHead>
                    <TableHead className="text-right">{t("columns.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">{row.version_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {t("versionCode", { code: row.version_code })}
                        </div>
                        {row.version_code === latestVersionCode ? (
                          <Badge variant="secondary" className="mt-1">
                            {t("latestBadge")}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(row.released_at).toLocaleString()}
                      </TableCell>
                      <TableCell>{formatBytes(row.apk_size_bytes)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {shortSha256(row.apk_sha256)}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={row.is_required}
                          disabled={isBusy}
                          onCheckedChange={(checked) =>
                            handleRequiredToggle(row, checked === true)
                          }
                          aria-label={t("columns.required")}
                        />
                      </TableCell>
                      <TableCell className="space-x-2">
                        {row.is_active ? (
                          <Badge>{t("status.active")}</Badge>
                        ) : (
                          <Badge variant="outline">{t("status.inactive")}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {!row.is_active ? (
                            <Button
                              size="sm"
                              className="cursor-pointer rounded-lg"
                              onClick={() => handleActivate(row.id)}
                              disabled={isBusy}
                            >
                              {t("actions.activate")}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            className="cursor-pointer rounded-lg"
                            onClick={() => void handleDownload(row.id)}
                            disabled={isBusy}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          {!row.is_active ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="cursor-pointer rounded-lg"
                              onClick={() => setDeleteTarget(row)}
                              disabled={isBusy}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </AppListCard>
        </TabsContent>

        <TabsContent value="adoption">
          <AppReleasesAdoptionPanel channel={channel} />
        </TabsContent>
      </Tabs>

      <UploadReleaseSheet
        open={uploadOpen}
        channel={channel}
        latestVersionCode={latestVersionCode}
        onOpenChange={setUploadOpen}
        onUploaded={() => {
          toast.success(t("toasts.uploaded"));
          setUploadOpen(false);
          void refetch();
        }}
      />

      <ConfirmDeleteDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        itemTitle={t("deleteDialog.title")}
        itemName={deleteTarget?.version_name ?? ""}
        confirmText={
          deleteTarget
            ? t("deleteDialog.confirmText", { version: deleteTarget.version_name })
            : ""
        }
        warning={t("deleteDialog.warning")}
        onConfirm={handleDeleteConfirm}
        isPending={remove.isPending}
      />
    </AppPage>
  );
}

function UploadReleaseSheet({
  open,
  channel,
  latestVersionCode,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  channel: AppReleaseChannel;
  latestVersionCode: number;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
}) {
  const t = useTranslations("pages.appReleases");
  const tUpload = useTranslations("pages.appReleases.upload");
  const [versionName, setVersionName] = useState("");
  const [versionCode, setVersionCode] = useState("");
  const [selectedChannel, setSelectedChannel] = useState<AppReleaseChannel>(channel);
  const [isRequired, setIsRequired] = useState(false);
  const [minSupported, setMinSupported] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<AppReleaseUploadProgress | null>(
    null,
  );

  const parsedCode = parseInt(versionCode, 10);
  const codeTooLow =
    versionCode.trim().length > 0 &&
    Number.isFinite(parsedCode) &&
    parsedCode <= latestVersionCode;

  useEffect(() => {
    if (open) setSelectedChannel(channel);
  }, [channel, open]);

  const reset = () => {
    setVersionName("");
    setVersionCode("");
    setIsRequired(false);
    setMinSupported("");
    setReleaseNotes("");
    setFile(null);
    setUploadProgress(null);
  };

  const progressLabel = uploadProgress
    ? uploadProgress.phase === "uploading"
      ? tUpload("progress.uploading", { percent: uploadProgress.percent })
      : tUpload(`progress.${uploadProgress.phase}`)
    : null;

  const handleSubmit = async () => {
    if (!file) {
      toast.error(tUpload("errors.missingApk"));
      return;
    }

    const controller = new AbortController();
    setIsPending(true);
    setUploadProgress({ phase: "hashing", percent: 0 });

    try {
      const result = await uploadAppReleaseWithProgress(
        {
          file,
          versionName,
          versionCode,
          channel: selectedChannel,
          isRequired,
          minSupported,
          releaseNotes,
        },
        setUploadProgress,
        controller.signal,
      );

      if (!result.ok) {
        const message = t(`errors.${result.error}`, { defaultValue: result.error });
        const details = "details" in result && result.details ? ` — ${result.details}` : "";
        toast.error(`${message}${details}`);
        return;
      }

      reset();
      onUploaded();
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("app release upload failed", error);
      }
      toast.error(t("errors.upload_failed"));
    } finally {
      setIsPending(false);
      setUploadProgress(null);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!isPending) onOpenChange(next);
        if (!next) reset();
      }}
    >
      <SheetContent className="flex h-full max-h-[100dvh] flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{tUpload("title")}</SheetTitle>
          <SheetDescription>{tUpload("description")}</SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
          {latestVersionCode > 0 ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {tUpload("latestHint", { code: latestVersionCode })}
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="apk-file">{tUpload("fields.apk")}</Label>
            <Input
              id="apk-file"
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="version-name">{tUpload("fields.versionName")}</Label>
              <Input
                id="version-name"
                placeholder="1.0.9"
                value={versionName}
                onChange={(event) => setVersionName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="version-code">{tUpload("fields.versionCode")}</Label>
              <Input
                id="version-code"
                placeholder="10"
                inputMode="numeric"
                value={versionCode}
                onChange={(event) => setVersionCode(event.target.value)}
              />
              {codeTooLow ? (
                <p className="text-xs text-destructive">
                  {tUpload("errors.versionCodeNotHigher", { code: latestVersionCode })}
                </p>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label>{tUpload("fields.channel")}</Label>
            <Select
              value={selectedChannel}
              onValueChange={(value) => setSelectedChannel(value as AppReleaseChannel)}
            >
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="production">{t("channels.production")}</SelectItem>
                <SelectItem value="beta">{t("channels.beta")}</SelectItem>
                <SelectItem value="internal">{t("channels.internal")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="min-supported">{tUpload("fields.minSupported")}</Label>
            <Input
              id="min-supported"
              placeholder={tUpload("fields.minSupportedPlaceholder")}
              inputMode="numeric"
              value={minSupported}
              onChange={(event) => setMinSupported(event.target.value)}
            />
          </div>
          <label htmlFor="is-required" className="flex cursor-pointer items-center gap-2">
            <Checkbox
              id="is-required"
              checked={isRequired}
              onCheckedChange={(checked) => setIsRequired(checked === true)}
            />
            <span className="text-sm leading-none">{tUpload("fields.required")}</span>
          </label>
          <div className="space-y-2">
            <Label htmlFor="release-notes">{tUpload("fields.releaseNotes")}</Label>
            <Textarea
              id="release-notes"
              rows={4}
              className="resize-none"
              value={releaseNotes}
              onChange={(event) => setReleaseNotes(event.target.value)}
            />
          </div>
          {isPending && uploadProgress ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{progressLabel}</span>
                <span className="font-medium tabular-nums">{uploadProgress.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
            </div>
          ) : null}
        </SheetBody>

        <SheetFooter>
          <Button
            variant="outline"
            className="cursor-pointer rounded-lg"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {tUpload("cancel")}
          </Button>
          <Button
            className="cursor-pointer rounded-lg"
            onClick={() => void handleSubmit()}
            disabled={isPending || codeTooLow}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {tUpload("submit")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
