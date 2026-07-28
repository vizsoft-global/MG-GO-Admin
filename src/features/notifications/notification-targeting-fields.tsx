"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { NOTIFICATION_SUPPORTED_TARGET_MODES } from "./constants";
import { RequiredLabel } from "./notification-form-primitives";
import {
  NotificationDriverPicker,
  NotificationGroupPicker,
  type NotificationDriverOption,
} from "./notification-driver-picker";
import { NotificationImportPanel } from "./notification-import-panel";
import { estimateNotificationAudience } from "./notifications-actions";
import { useNotificationTargetingOptions } from "./use-notifications";
import type { NotificationImportSpec, TargetSpec } from "./types";

const DRIVER_STATUSES = ["active", "onboarding", "suspended", "inactive"] as const;

type Props = {
  targetMode: TargetSpec["mode"];
  zoneIds: string[];
  partnerIds: string[];
  groupIds?: string[];
  driverIds: string[];
  driverOptions?: NotificationDriverOption[];
  statuses: string[];
  importSpec?: NotificationImportSpec | null;
  titleTemplate?: string;
  bodyTemplate?: string;
  onTargetModeChange: (mode: TargetSpec["mode"]) => void;
  onZoneIdsChange: (ids: string[]) => void;
  onPartnerIdsChange: (ids: string[]) => void;
  onGroupIdsChange?: (ids: string[]) => void;
  onDriverIdsChange: (ids: string[], options?: NotificationDriverOption[]) => void;
  onStatusesChange: (statuses: string[]) => void;
  onImportSpecChange?: (spec: NotificationImportSpec | null) => void;
  onImportPreviewRowChange?: (index: number) => void;
  onImportPreviewStatsChange?: (stats: { okCount: number; totalCount: number } | null) => void;
  showEstimate?: boolean;
  onAudienceCountChange?: (count: number | null) => void;
};

export function NotificationTargetingFields({
  targetMode,
  zoneIds,
  partnerIds,
  groupIds = [],
  driverIds,
  driverOptions = [],
  statuses,
  importSpec = null,
  titleTemplate = "",
  bodyTemplate = "",
  onTargetModeChange,
  onZoneIdsChange,
  onPartnerIdsChange,
  onGroupIdsChange = () => {},
  onDriverIdsChange,
  onStatusesChange,
  onImportSpecChange = () => {},
  onImportPreviewRowChange,
  onImportPreviewStatsChange,
  showEstimate = true,
  onAudienceCountChange,
}: Props) {
  const t = useTranslations("pages.notifications");
  const { data: targeting } = useNotificationTargetingOptions();
  const [audienceCount, setAudienceCount] = useState<number | null>(null);

  const targetSpec = useMemo<TargetSpec>(() => {
    if (targetMode === "zone") return { mode: "zone", zone_ids: zoneIds };
    if (targetMode === "partner") return { mode: "partner", partner_ids: partnerIds };
    if (targetMode === "group") return { mode: "group", group_ids: groupIds };
    if (targetMode === "custom") return { mode: "custom", driver_ids: driverIds };
    if (targetMode === "status") return { mode: "status", statuses };
    if (targetMode === "import") return { mode: "import" };
    return { mode: targetMode };
  }, [targetMode, zoneIds, partnerIds, groupIds, driverIds, statuses]);

  async function refreshAudience() {
    try {
      const count = await estimateNotificationAudience(
        targetSpec,
        {},
        importSpec ?? undefined,
      );
      setAudienceCount(count);
      onAudienceCountChange?.(count);
    } catch {
      toast.error(t("errors.audienceEstimateFailed"));
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <RequiredLabel required>{t("targetMode")}</RequiredLabel>
        <Select value={targetMode} onValueChange={(v) => {
          onTargetModeChange(v as TargetSpec["mode"]);
          setAudienceCount(null);
          onAudienceCountChange?.(null);
        }}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOTIFICATION_SUPPORTED_TARGET_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {t(`targetModes.${mode}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {targetMode === "zone" ? (
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
          {(targeting?.zones ?? []).map((z) => (
            <label key={z.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border"
                checked={zoneIds.includes(z.id)}
                onChange={(e) =>
                  onZoneIdsChange(
                    e.target.checked ? [...zoneIds, z.id] : zoneIds.filter((id) => id !== z.id),
                  )
                }
              />
              {z.name}
            </label>
          ))}
        </div>
      ) : null}
      {targetMode === "partner" ? (
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
          {(targeting?.partners ?? []).map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border"
                checked={partnerIds.includes(p.id)}
                onChange={(e) =>
                  onPartnerIdsChange(
                    e.target.checked ? [...partnerIds, p.id] : partnerIds.filter((id) => id !== p.id),
                  )
                }
              />
              {p.name}
            </label>
          ))}
        </div>
      ) : null}
      {targetMode === "group" ? (
        <NotificationGroupPicker
          groups={targeting?.groups ?? []}
          selectedIds={groupIds}
          onChange={onGroupIdsChange}
        />
      ) : null}
      {targetMode === "status" ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          {DRIVER_STATUSES.map((status) => (
            <label key={status} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border"
                checked={statuses.includes(status)}
                onChange={(e) =>
                  onStatusesChange(
                    e.target.checked ? [...statuses, status] : statuses.filter((s) => s !== status),
                  )
                }
              />
              {t(`driverStatuses.${status}`)}
            </label>
          ))}
        </div>
      ) : null}
      {targetMode === "custom" ? (
        <NotificationDriverPicker
          selectedIds={driverIds}
          selectedOptions={driverOptions}
          onChange={(ids, options) => onDriverIdsChange(ids, options)}
        />
      ) : null}
      {targetMode === "import" ? (
        <NotificationImportPanel
          titleTemplate={titleTemplate}
          bodyTemplate={bodyTemplate}
          importSpec={importSpec}
          onImportSpecChange={(spec) => {
            onImportSpecChange(spec);
            if (!spec) {
              setAudienceCount(null);
              onAudienceCountChange?.(null);
              onImportPreviewStatsChange?.(null);
            }
          }}
          onPreviewRowChange={onImportPreviewRowChange}
          onImportPreviewStatsChange={(stats) => {
            onImportPreviewStatsChange?.(stats);
            const count = stats?.okCount ?? null;
            setAudienceCount(count);
            onAudienceCountChange?.(count);
          }}
        />
      ) : null}
      {showEstimate ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
          <p className="text-sm text-muted-foreground">
            {audienceCount == null
              ? t("audienceEstimateHint")
              : t("audienceEstimate", { count: audienceCount })}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer"
            onClick={() => void refreshAudience()}
          >
            {t("estimateAudience")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
