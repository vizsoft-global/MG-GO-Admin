/**
 * Resolve effective screenshot restriction for a campaign.
 * override: null = inherit template, true = force on, false = force off.
 */
export function resolveScreenshotRestricted(
  override: boolean | null | undefined,
  templateFlag: boolean | null | undefined,
): boolean {
  if (override === true) return true;
  if (override === false) return false;
  return Boolean(templateFlag);
}

export function screenshotRestrictedToFcmValue(restricted: boolean): "true" | "false" {
  return restricted ? "true" : "false";
}
