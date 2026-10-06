export function esignRemindBody(custom: string | null | undefined, title: string): string {
  return custom?.trim() || title;
}

export function esignRemindChannelLive(channel: "app" | "sms" | "email"): boolean {
  return channel === "app";
}
