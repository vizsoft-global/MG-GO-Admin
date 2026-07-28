"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NOTIFICATION_ACTION_TYPES } from "./constants";
import { RequiredLabel } from "./notification-form-primitives";
import {
  NOTIFICATION_ACTION_PRESETS,
  actionToPreset,
  describeNotificationAction,
  presetToAction,
  type NotificationActionPreset,
} from "./notification-action-presets";
import type { NotificationActionType } from "./types";

const DRIVER_MODULES = ["deliveries", "earnings", "attendance", "documents", "support"] as const;

export function buildActionParams(
  actionType: NotificationActionType,
  fields: Record<string, string>,
): Record<string, unknown> {
  const { preset } = actionToPreset(actionType, {});
  if (fields.preset) {
    return presetToAction(fields.preset as NotificationActionPreset, fields).actionParams;
  }
  switch (actionType) {
    case "open_screen":
      return { screen: fields.screen || "home" };
    case "open_module":
      return { module: fields.module || "deliveries" };
    case "open_record":
      return {
        module: fields.module || "deliveries",
        record_id: fields.recordId || "",
      };
    case "open_workflow":
      return { workflow: fields.workflow || "delivery_submit" };
    case "open_url":
      return { url: fields.url || "" };
    case "custom_payload":
      return { payload: fields.payload ? JSON.parse(fields.payload) : {} };
    case "silent_update_trigger":
      return { trigger: fields.trigger || "refresh_home" };
    default:
      return {};
  }
}

export function parseActionFields(
  actionType: NotificationActionType,
  params: Record<string, unknown>,
): Record<string, string> {
  const { preset, fields } = actionToPreset(actionType, params);
  return { preset, ...fields };
}

export function resolveActionFromFields(fields: Record<string, string>): {
  actionType: NotificationActionType;
  actionParams: Record<string, unknown>;
} {
  const preset = (fields.preset ?? "open_home") as NotificationActionPreset;
  if (preset === "advanced") {
    const advancedType = (fields.advancedType || "custom_payload") as NotificationActionType;
    try {
      if (advancedType === "custom_payload") {
        return {
          actionType: advancedType,
          actionParams: { payload: fields.payload ? JSON.parse(fields.payload) : {} },
        };
      }
      return {
        actionType: advancedType,
        actionParams: buildActionParams(advancedType, fields),
      };
    } catch {
      return { actionType: "open_screen", actionParams: { screen: "notifications" } };
    }
  }
  const mapped = presetToAction(preset, fields);
  return {
    actionType: mapped.actionType as NotificationActionType,
    actionParams: mapped.actionParams,
  };
}

export function NotificationActionFields({
  actionType,
  fields,
  onActionTypeChange,
  onFieldChange,
}: {
  actionType: NotificationActionType;
  fields: Record<string, string>;
  onActionTypeChange: (type: NotificationActionType) => void;
  onFieldChange: (key: string, value: string) => void;
}) {
  const t = useTranslations("pages.notifications");
  const preset = (fields.preset ?? actionToPreset(actionType, {}).preset) as NotificationActionPreset;
  const [showAdvanced, setShowAdvanced] = useState(preset === "advanced");

  const effectSummary = useMemo(
    () => describeNotificationAction(actionType, fields, t),
    [actionType, fields, t],
  );

  const setPreset = (next: NotificationActionPreset) => {
    onFieldChange("preset", next);
    if (next === "advanced") {
      setShowAdvanced(true);
      onActionTypeChange("custom_payload");
      onFieldChange("payload", fields.payload ?? "{}");
      return;
    }
    setShowAdvanced(false);
    const mapped = presetToAction(next, fields);
    onActionTypeChange(mapped.actionType as NotificationActionType);
    if (mapped.actionType === "open_screen") {
      onFieldChange("screen", String(mapped.actionParams.screen ?? "home"));
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <RequiredLabel required>{t("fieldTapAction")}</RequiredLabel>
        <Select value={preset} onValueChange={(v) => setPreset(v as NotificationActionPreset)}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOTIFICATION_ACTION_PRESETS.filter((p) => p !== "advanced").map((item) => (
              <SelectItem key={item} value={item}>
                {t(`actionPresets.${item}`)}
              </SelectItem>
            ))}
            <SelectItem value="advanced">{t("actionPresets.advanced")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {preset === "open_record" ? (
        <>
          <div className="space-y-1">
            <RequiredLabel required>{t("fieldActionModule")}</RequiredLabel>
            <Select
              value={fields.module ?? "deliveries"}
              onValueChange={(v) => onFieldChange("module", v ?? "deliveries")}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DRIVER_MODULES.map((mod) => (
                  <SelectItem key={mod} value={mod}>
                    {t(`actionModules.${mod}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <RequiredLabel required>{t("fieldActionRecordId")}</RequiredLabel>
            <Input
              className="h-9"
              value={fields.recordId ?? ""}
              onChange={(e) => onFieldChange("recordId", e.target.value)}
            />
          </div>
        </>
      ) : null}

      {preset === "open_url" ? (
        <div className="space-y-1">
          <RequiredLabel required>{t("fieldActionUrl")}</RequiredLabel>
          <Input
            className="h-9"
            type="url"
            value={fields.url ?? ""}
            onChange={(e) => onFieldChange("url", e.target.value)}
          />
        </div>
      ) : null}

      {showAdvanced ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
          <div className="space-y-1">
            <Label>{t("fieldActionType")}</Label>
            <Select
              value={fields.advancedType ?? actionType}
              onValueChange={(v) => {
                onFieldChange("advancedType", v ?? "custom_payload");
                onActionTypeChange((v ?? "custom_payload") as NotificationActionType);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTIFICATION_ACTION_TYPES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t(`actionTypes.${item}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(fields.advancedType ?? actionType) === "custom_payload" ? (
            <div className="space-y-1">
              <Label>{t("fieldActionParams")}</Label>
              <textarea
                className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                value={fields.payload ?? "{}"}
                onChange={(e) => onFieldChange("payload", e.target.value)}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
        <p className="text-xs font-semibold">{t("actionEffectTitle")}</p>
        <p className="mt-0.5 text-xs">{effectSummary}</p>
      </div>
    </div>
  );
}
