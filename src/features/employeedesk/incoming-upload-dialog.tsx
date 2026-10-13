"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Calendar, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect, type SearchSelectItem } from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { fileToDecisionAttachmentPayload } from "@/features/requests/request-attach-dialog";
import { useRequestCreateOptions, useUploadIncomingDocument } from "@/features/requests/use-requests";

const CATEGORIES = ["letter", "memo", "legal", "hr", "other", "sick_leave"] as const;

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function IncomingUploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.rcmV2.upload");
  const tTypes = useTranslations("pages.rcmV2.types");
  const tRcm = useTranslations("pages.rcmV2");
  const options = useRequestCreateOptions(open);
  const upload = useUploadIncomingDocument();
  const fileRef = useRef<HTMLInputElement>(null);
  const [driverId, setDriverId] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("letter");
  const [subject, setSubject] = useState("");
  const [receivedOn, setReceivedOn] = useState(kuwaitTodayYmd());
  const [startRoute, setStartRoute] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const drivers = options.data?.drivers ?? [];

  const driverItems = useMemo<SearchSelectItem[]>(
    () =>
      drivers.map((driver) => ({
        value: driver.id,
        label: driver.employee_id || driver.driver_code || driver.full_name,
        keywords: [driver.full_name, driver.driver_code, driver.employee_id ?? "", driver.phone ?? ""],
      })),
    [drivers],
  );

  const selectedDriver = drivers.find((driver) => driver.id === driverId);

  function categoryLabel(value: (typeof CATEGORIES)[number]) {
    if (value === "sick_leave") return tTypes("sick_leave");
    return t(`categories.${value}`);
  }

  function addFiles(list: FileList | null) {
    const next = Array.from(list ?? []);
    if (next.length === 0) return;
    setFiles((current) => [...current, ...next]);
  }

  async function submit() {
    if (!driverId || !subject.trim() || files.length === 0) {
      toast.error(t("required"));
      return;
    }
    const payloads = await Promise.all(files.map((file) => fileToDecisionAttachmentPayload(file)));
    const result = await upload.mutateAsync({
      driverId,
      category,
      subject: subject.trim(),
      receivedOn,
      startRoute,
      files: payloads,
    });
    if (!result.ok) {
      toast.error(result.error ?? t("failed"));
      return;
    }
    toast.success(t("saved", { code: result.request_code ?? "" }));
    setSubject("");
    setFiles([]);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !upload.isPending && onOpenChange(next)}>
      <DialogContent
        className="flex max-h-[min(92vh,760px)] w-[min(720px,96vw)] flex-col gap-0 rounded-xl p-0"
        showCloseButton={!upload.isPending}
      >
        <DialogHeader className="border-b border-border px-5 py-3 pe-14">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("category")}
            </Label>
            <Select
              items={CATEGORIES.map((value) => ({
                value,
                label: categoryLabel(value),
              }))}
              value={category}
              onValueChange={(next) => {
                if (next) setCategory(next as (typeof CATEGORIES)[number]);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value} label={categoryLabel(value)}>
                    {categoryLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("employeeId")}
            </Label>
            <SearchSelect
              value={driverId}
              onChange={(next) => setDriverId(next ?? "")}
              items={driverItems}
              placeholder={t("driverPlaceholder")}
              searchPlaceholder={t("driverPlaceholder")}
              recentsKey="incoming-upload-driver"
            />
            {selectedDriver ? (
              <p className="text-[10px] text-muted-foreground">
                {tRcm("fromSystem", {
                  name: selectedDriver.full_name,
                  role: t("driver"),
                  zone: selectedDriver.zone_name || "—",
                })}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("subject")}
            </Label>
            <Input className="h-9" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("receivedOn")}
            </Label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="date"
                className="h-9 ps-8"
                value={receivedOn}
                onChange={(event) => setReceivedOn(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("files")}
            </Label>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              multiple
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            {files.length === 0 ? (
              <button
                type="button"
                className="flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/40"
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="size-3.5" />
                {t("browse")}
              </button>
            ) : (
              <ul className="space-y-1">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex h-9 items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm"
                  >
                    <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(file.size)}</span>
                    <button
                      type="button"
                      className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted"
                      aria-label={t("removeFile")}
                      onClick={() => setFiles((current) => current.filter((_, item) => item !== index))}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="cursor-pointer text-[12px] font-medium text-foreground underline"
                    onClick={() => fileRef.current?.click()}
                  >
                    {t("browse")}
                  </button>
                </li>
              </ul>
            )}
          </div>
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("startRoute")}</p>
              <p className="text-[10px] text-muted-foreground">{t("routeHint")}</p>
            </div>
            <Switch
              checked={startRoute}
              onCheckedChange={(checked) => setStartRoute(checked === true)}
              aria-label={t("startRoute")}
            />
          </div>
        </div>
        <DialogFooter className="border-t border-border px-5 py-3 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={upload.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            className="h-9 bg-zinc-950 text-white hover:bg-zinc-800"
            disabled={upload.isPending}
            onClick={() => void submit()}
          >
            {upload.isPending ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : null}
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
