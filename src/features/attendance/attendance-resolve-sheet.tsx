"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { AttendanceExceptionRow, ExceptionResolutionStatus } from "./attendance-reporting-types";
import { useUpsertAttendanceException } from "./use-attendance-table";

export function AttendanceResolveSheet({
  row,
  open,
  onOpenChange,
}: {
  row: AttendanceExceptionRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.attendance");
  const { mutateAsync, isPending } = useUpsertAttendanceException();
  const [status, setStatus] = useState<ExceptionResolutionStatus>("acknowledged");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!row || !open) return;
    setStatus(
      (row.resolution_status as ExceptionResolutionStatus) ?? "acknowledged",
    );
    setNote(row.supervisor_note ?? "");
  }, [row, open]);

  async function handleSave() {
    if (!row) return;
    const result = await mutateAsync({
      exceptionKey: row.exception_key,
      driverId: row.driver_id,
      exceptionType: row.exception_type,
      exceptionDate: row.exception_date,
      resolutionStatus: status,
      action: status,
      note: note.trim() || undefined,
    });
    if (!result.success) {
      toast.error(result.error ?? t("errors.saveFailed"));
      return;
    }
    toast.success(t("exceptionResolved"));
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("resolveTitle")}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          {row ? (
            <p className="text-sm text-muted-foreground">
              {row.driver_name} · {row.exception_type}
            </p>
          ) : null}
          <div className="space-y-2">
            <Label>{t("resolutionStatus")}</Label>
            <Select
              value={status}
              onValueChange={(v) => v && setStatus(v as ExceptionResolutionStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">{t("resolutionOpen")}</SelectItem>
                <SelectItem value="acknowledged">{t("resolutionAcknowledged")}</SelectItem>
                <SelectItem value="resolved">{t("resolutionResolved")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("correctionNote")}</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("resolveNotePlaceholder")}
              rows={4}
            />
          </div>
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isPending || !row}>
            {isPending ? t("saving") : t("saveResolution")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
