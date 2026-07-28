"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { invalidateDriverCaches } from "./invalidate-driver-caches";
import { selectOptionsFrom } from "@/lib/select-items";
import { updateDriverAccountStatus } from "./drivers-actions";
import { isDriverErrorKey } from "./driver-errors";
import { AccountStatusPill } from "./driver-list-ui";
import {
  DRIVER_ACCOUNT_STATUSES,
  type DriverAccountStatus,
} from "./types";

export function DriverAccountStatusEditor({
  driverId,
  intakeId,
  status,
  hasPublishedRestaurant,
  canManage,
}: {
  driverId: string;
  intakeId?: string | null;
  status: DriverAccountStatus;
  hasPublishedRestaurant: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("pages.driverDetail.accountStatus");
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();

  const labelFor = (value: DriverAccountStatus) => {
    switch (value) {
      case "active":
        return t("active");
      case "suspended":
        return t("suspended");
      case "pending":
        return t("pending");
      default:
        return value;
    }
  };

  const onChange = (next: string | null) => {
    if (!next || next === status || !canManage) return;
    const nextStatus = next as DriverAccountStatus;
    if (nextStatus === "active" && !hasPublishedRestaurant) {
      toast.error(t("missingRestaurant"));
      return;
    }

    startTransition(async () => {
      const result = await updateDriverAccountStatus(driverId, nextStatus);
      if ("error" in result) {
        const key = isDriverErrorKey(result.error) ? result.error : "save_failed";
        toast.error(t(`errors.${key}` as "errors.save_failed"));
        return;
      }
      toast.success(t("updated"));
      await invalidateDriverCaches(queryClient, { intakeId, profileId: driverId });
    });
  };

  const items = selectOptionsFrom(
    DRIVER_ACCOUNT_STATUSES,
    (s) => s,
    (s) => labelFor(s),
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{t("label")}</Label>
        <AccountStatusPill status={status} label={labelFor(status)} />
      </div>
      {canManage ? (
        <Select
          items={items}
          value={status}
          onValueChange={onChange}
          disabled={isPending}
        >
          <SelectTrigger className="h-9 w-full cursor-pointer rounded-lg bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DRIVER_ACCOUNT_STATUSES.map((s) => (
              <SelectItem
                key={s}
                value={s}
                label={labelFor(s)}
                disabled={s === "active" && !hasPublishedRestaurant}
              >
                {labelFor(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {!hasPublishedRestaurant ? (
        <p className="text-xs text-muted-foreground">{t("restaurantRequired")}</p>
      ) : null}
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : null}
    </div>
  );
}
