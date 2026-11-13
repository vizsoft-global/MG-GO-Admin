/** Category → icon tint + chip classes for the activity feed. */
export type OperationCategoryTone =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "neutral";

const CATEGORY_TONES: Record<string, OperationCategoryTone> = {
  auth: "primary",
  duty: "success",
  location: "primary",
  delivery: "success",
  request: "warning",
  esign: "warning",
  visit: "warning",
  notification: "neutral",
  profile: "neutral",
  upload: "neutral",
  device: "primary",
  security: "danger",
  admin_action: "neutral",
};

export function operationCategoryTone(category: string): OperationCategoryTone {
  return CATEGORY_TONES[category] ?? "neutral";
}

/**
 * next-intl reads `.` as nesting, so an operation key cannot be a message key
 * verbatim: `delivery.pickup_create` becomes `delivery_pickup_create`.
 */
export function operationMessageKey(operationKey: string): string {
  // An event with no key must not take the page down with it.
  return typeof operationKey === "string" ? operationKey.replace(/\./g, "_") : "unknown";
}

/**
 * `delivery.pickup_create` → `Pickup create`. New operation keys ship from the
 * database before anyone adds a translation, so an unlabelled key must still
 * read as English rather than leaving the feed row blank.
 */
export function humanizeOperationKey(operationKey: string): string {
  if (typeof operationKey !== "string" || operationKey === "") return "Unknown";
  const tail = operationKey.includes(".")
    ? operationKey.slice(operationKey.indexOf(".") + 1)
    : operationKey;
  const words = tail.replace(/[._-]+/g, " ").trim();
  if (!words) return operationKey;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function humanizeCategory(category: string): string {
  if (typeof category !== "string") return "Unknown";
  const words = category.replace(/[._-]+/g, " ").trim();
  if (!words) return category;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Failure codes come straight from `RAISE EXCEPTION 'active_pickup_exists'`, so
 * they are readable enough humanized and never worth a translation each.
 */
export function humanizeErrorCode(errorCode: string): string {
  if (typeof errorCode !== "string") return "";
  const words = errorCode.replace(/[._-]+/g, " ").trim();
  if (!words) return errorCode;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
