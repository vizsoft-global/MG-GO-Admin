import type { useTranslations } from "next-intl";

export const NOTIFICATION_ACTION_PRESETS = [
  "open_home",
  "open_deliveries",
  "open_earnings",
  "open_profile",
  "open_notifications",
  "open_record",
  "open_url",
  "message_only",
  "advanced",
] as const;

export type NotificationActionPreset = (typeof NOTIFICATION_ACTION_PRESETS)[number];

export function presetToAction(preset: NotificationActionPreset, fields: Record<string, string>) {
  switch (preset) {
    case "open_home":
      return { actionType: "open_screen" as const, actionParams: { screen: "home" } };
    case "open_deliveries":
      return { actionType: "open_screen" as const, actionParams: { screen: "deliveries" } };
    case "open_earnings":
      return { actionType: "open_screen" as const, actionParams: { screen: "earnings" } };
    case "open_profile":
      return { actionType: "open_screen" as const, actionParams: { screen: "profile" } };
    case "open_notifications":
    case "message_only":
      return { actionType: "open_screen" as const, actionParams: { screen: "notifications" } };
    case "open_record":
      return {
        actionType: "open_record" as const,
        actionParams: {
          module: fields.module || "deliveries",
          record_id: fields.recordId || "",
        },
      };
    case "open_url":
      return { actionType: "open_url" as const, actionParams: { url: fields.url || "" } };
    default:
      return {
        actionType: (fields.advancedType || "custom_payload") as "custom_payload",
        actionParams: fields.payload ? JSON.parse(fields.payload) : {},
      };
  }
}

export function actionToPreset(
  actionType: string,
  params: Record<string, unknown>,
): { preset: NotificationActionPreset; fields: Record<string, string> } {
  if (actionType === "open_screen") {
    const screen = String(params.screen ?? "home");
    const map: Record<string, NotificationActionPreset> = {
      home: "open_home",
      deliveries: "open_deliveries",
      earnings: "open_earnings",
      profile: "open_profile",
      notifications: "open_notifications",
    };
    return { preset: map[screen] ?? "open_home", fields: { screen } };
  }
  if (actionType === "open_record") {
    return {
      preset: "open_record",
      fields: {
        module: String(params.module ?? "deliveries"),
        recordId: String(params.record_id ?? ""),
      },
    };
  }
  if (actionType === "open_url") {
    return { preset: "open_url", fields: { url: String(params.url ?? "") } };
  }
  return {
    preset: "advanced",
    fields: {
      advancedType: actionType,
      payload: JSON.stringify(params, null, 2),
    },
  };
}

type TFn = ReturnType<typeof useTranslations>;

export function describeNotificationAction(
  actionType: string,
  fields: Record<string, string>,
  t: TFn,
): string {
  const preset = (fields.preset ??
    actionToPreset(actionType, {
      screen: fields.screen,
      module: fields.module,
      record_id: fields.recordId,
      url: fields.url,
    }).preset) as NotificationActionPreset;
  if (preset === "open_record") {
    return t("actionEffects.open_record", {
      module: t(`actionModules.${fields.module ?? "deliveries"}`),
      recordId: fields.recordId || "—",
    });
  }
  if (preset === "open_url") {
    return t("actionEffects.open_url", { url: fields.url || "—" });
  }
  if (preset === "message_only" || preset === "open_notifications") {
    return t("actionEffects.message_only");
  }
  if (preset === "advanced") {
    return t("actionEffects.advanced");
  }
  return t(`actionEffects.${preset}`);
}