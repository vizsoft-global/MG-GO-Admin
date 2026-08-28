"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ClipboardList, Gauge, MapPin, Shirt, Timer, User } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { ToggleChip } from "@/components/app/toggle-chip";
import { SectionHeading } from "@/features/drivers/form/driver-form-primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect, type SearchSelectItem } from "@/components/ui/search-select";
import { Textarea } from "@/components/ui/textarea";
import { saveWrongAction } from "./wrong-actions-actions";
import type { WrongActionDriverOption } from "./wrong-actions-actions";
import {
  WRONG_ACTION_SEVERITIES,
  WRONG_ACTION_SEVERITY_WEIGHT,
  WRONG_ACTION_TYPES,
  type WrongActionRow,
  type WrongActionSeverity,
  type WrongActionType,
} from "./types";

const TYPE_ICON = {
  delay: Timer,
  zone_breach: MapPin,
  hygiene_failed: Gauge,
  uniform: Shirt,
  other: ClipboardList,
} as const;

/**
 * `datetime-local` wants wall-clock in the browser's own zone, which is what the
 * operator is reading off their screen. The value is converted back to an
 * instant on submit; only the display is local.
 */
function toLocalInput(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function WrongActionFormDialog({
  open,
  incident,
  drivers,
  driversLoading,
  lockedDriverId,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  incident: WrongActionRow | null;
  drivers: WrongActionDriverOption[];
  driversLoading: boolean;
  lockedDriverId?: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("pages.wrongActions");
  const [pending, startTransition] = useTransition();
  const [driverId, setDriverId] = useState("");
  const [actionType, setActionType] = useState<WrongActionType>("delay");
  const [severity, setSeverity] = useState<WrongActionSeverity>("low");
  const [details, setDetails] = useState("");
  const [occurredAt, setOccurredAt] = useState("");

  useEffect(() => {
    if (!open) return;
    setDriverId(incident?.driver_id ?? lockedDriverId ?? "");
    setActionType(incident?.action_type ?? "delay");
    setSeverity(incident?.severity ?? "low");
    setDetails(incident?.details ?? "");
    setOccurredAt(toLocalInput(incident?.occurred_at));
  }, [open, incident, lockedDriverId]);

  const driverItems = useMemo<SearchSelectItem[]>(
    () =>
      drivers.map((driver) => ({
        value: driver.id,
        label: driver.full_name,
        hint: [driver.driver_code, driver.employee_id, driver.zone_name]
          .filter(Boolean)
          .join(" · "),
        keywords: [
          driver.full_name,
          driver.driver_code,
          driver.employee_id ?? "",
          driver.zone_name ?? "",
        ].filter(Boolean),
      })),
    [drivers],
  );

  const maxLocal = toLocalInput(new Date().toISOString());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        closeOutside
        className="w-[min(1000px,96vw)] overflow-visible px-5 py-4"
      >
        <form
          className="space-y-3 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData();
            if (incident?.id) formData.set("id", incident.id);
            formData.set("driverId", driverId);
            formData.set("actionType", actionType);
            formData.set("severity", severity);
            formData.set("details", details);
            formData.set(
              "occurredAt",
              occurredAt ? new Date(occurredAt).toISOString() : "",
            );
            startTransition(async () => {
              const result = await saveWrongAction(formData);
              if (result.error || !result.id) {
                toast.error(
                  t(`errors.${result.error ?? "save_failed"}` as "errors.save_failed"),
                );
                return;
              }
              toast.success(t("saved"));
              onSaved(result.id);
            });
          }}
        >
          <SectionHeading icon={User} accent="primary">
            {t("sectionWho")}
          </SectionHeading>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>
                {t("fieldDriver")} <span className="text-destructive">*</span>
              </Label>
              <SearchSelect
                items={driverItems}
                value={driverId}
                onChange={(value) => setDriverId(value ?? "")}
                placeholder={driversLoading ? t("loading") : t("driverPlaceholder")}
                searchPlaceholder={t("driverSearchPlaceholder")}
                emptyText={t("driverEmpty")}
                recentsKey="wrong-actions-driver"
                disabled={driversLoading || Boolean(lockedDriverId)}
                clearable={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                {t("fieldOccurredAt")} <span className="text-destructive">*</span>
              </Label>
              <Input
                type="datetime-local"
                value={occurredAt}
                max={maxLocal}
                onChange={(event) => setOccurredAt(event.target.value)}
                className="h-9"
                required
              />
              <p className="text-[10px] text-muted-foreground">{t("occurredHint")}</p>
            </div>
          </div>

          <SectionHeading icon={AlertTriangle} accent="warning">
            {t("sectionWhat")}
          </SectionHeading>
          <div className="space-y-1.5">
            <Label>
              {t("colType")} <span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {WRONG_ACTION_TYPES.map((value) => (
                <ToggleChip
                  key={value}
                  selected={actionType === value}
                  icon={TYPE_ICON[value]}
                  onClick={() => setActionType(value)}
                >
                  {t(`type.${value}` as "type.delay")}
                </ToggleChip>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>
              {t("colSeverity")} <span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {WRONG_ACTION_SEVERITIES.map((value) => (
                <ToggleChip
                  key={value}
                  selected={severity === value}
                  icon={AlertTriangle}
                  onClick={() => setSeverity(value)}
                >
                  {t(`severity.${value}` as "severity.low")}
                </ToggleChip>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t("severityWeightHint", { weight: WRONG_ACTION_SEVERITY_WEIGHT[severity] })}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>{t("fieldDetails")}</Label>
            <Textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              rows={3}
              placeholder={t("detailsPlaceholder")}
            />
          </div>

          <AppModalFooter
            title={incident ? t("editTitle") : t("addTitle")}
            subtitle={t("formSubtitle")}
          >
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" className="h-9" disabled={pending || !driverId}>
              {t("save")}
            </Button>
          </AppModalFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
