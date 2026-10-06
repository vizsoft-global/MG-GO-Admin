"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { fileToDecisionAttachmentPayload } from "@/features/requests/request-attach-dialog";
import { useRequestCreateOptions, useUploadIncomingDocument } from "@/features/requests/use-requests";

const CATEGORIES = ["letter", "memo", "legal", "hr", "other"] as const;

export function IncomingUploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.rcmV2.upload");
  const options = useRequestCreateOptions(open);
  const upload = useUploadIncomingDocument();
  const [driverId, setDriverId] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("letter");
  const [subject, setSubject] = useState("");
  const [receivedOn, setReceivedOn] = useState(kuwaitTodayYmd());
  const [startRoute, setStartRoute] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const driverItems = useMemo<SearchSelectItem[]>(
    () =>
      (options.data?.drivers ?? []).map((driver) => ({
        value: driver.id,
        label: `${driver.full_name} · ${driver.driver_code}`,
        keywords: [driver.employee_id ?? "", driver.phone ?? ""],
      })),
    [options.data?.drivers],
  );

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
        className="flex max-h-[min(92vh,760px)] w-[min(720px,96vw)] flex-col gap-0 overflow-visible rounded-xl p-0"
        showCloseButton={!upload.isPending}
        closeOutside
      >
        <div className="space-y-3 px-5 pb-4 pt-4">
          <div className="space-y-1.5">
            <Label>{t("driver")}</Label>
            <SearchSelect
              value={driverId}
              onChange={(next) => setDriverId(next ?? "")}
              items={driverItems}
              placeholder={t("driverPlaceholder")}
              recentsKey="incoming-upload-driver"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>{t("category")}</Label>
              <Select
                items={CATEGORIES.map((value) => ({
                  value,
                  label: t(`categories.${value}`),
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
                    <SelectItem key={value} value={value} label={t(`categories.${value}`)}>
                      {t(`categories.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("receivedOn")}</Label>
              <Input
                type="date"
                className="h-9"
                value={receivedOn}
                onChange={(event) => setReceivedOn(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("subject")}</Label>
            <Input className="h-9" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("files")}</Label>
            <Input
              type="file"
              className="h-9"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={startRoute} onCheckedChange={(value) => setStartRoute(value === true)} />
            {t("startRoute")}
          </label>
        </div>
        <AppModalFooter title={t("title")} subtitle={t("subtitle")}>
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" className="h-9" disabled={upload.isPending} onClick={() => void submit()}>
            {upload.isPending ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : <Upload className="me-1.5 size-3.5" />}
            {t("submit")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
