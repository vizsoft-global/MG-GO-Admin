export type RestrictionReasonKind = "block" | "freeze" | "both";

export type RestrictionReason = {
  id: string;
  kind: RestrictionReasonKind;
  label_en: string;
  label_ar: string;
  sort_order: number;
};

/** Kuwait calendar day `YYYY-MM-DD`. Inclusive window — matches SQL `driver_freeze_is_active`. */

export function freezeWindowIsActive(
  from: string | null | undefined,
  until: string | null | undefined,
  todayYmd: string,
): boolean {
  if (!from || !until) return false;
  return todayYmd >= from && todayYmd <= until;
}

export type FreezeUiState = "inactive" | "scheduled" | "active" | "expired";

export function freezeUiState(
  from: string | null | undefined,
  until: string | null | undefined,
  todayYmd: string,
): FreezeUiState {
  if (!from || !until) return "inactive";
  if (todayYmd < from) return "scheduled";
  if (todayYmd > until) return "expired";
  return "active";
}

export function formatFreezeLoginReason(reason: string | null | undefined, untilYmd: string): string {
  const base = reason?.trim() || "Account frozen";
  return `${base} (until ${untilYmd})`;
}

export type PasscodeLookupDriver = {
  id: string;
  driver_code: string;
  status: string;
  archived_at: string | null;
  is_blocked: boolean;
  blocked_reason: string | null;
  frozen_from?: string | null;
  frozen_until?: string | null;
  freeze_reason?: string | null;
};

export type PasscodeLookupResult =
  | { ok: true; user_id: string; driver_code: string }
  | { ok: false; error: string; reason?: string | null };

/** Mirrors `driver_app_lookup_by_passcode` after the row is found. */
export function resolvePasscodeLookup(
  driver: PasscodeLookupDriver,
  todayYmd: string,
): PasscodeLookupResult {
  if (driver.archived_at != null) {
    return { ok: false, error: "driver_archived" };
  }
  if (driver.is_blocked) {
    return {
      ok: false,
      error: "driver_blocked",
      reason: driver.blocked_reason?.trim() || null,
    };
  }
  if (freezeWindowIsActive(driver.frozen_from, driver.frozen_until, todayYmd)) {
    return {
      ok: false,
      error: "driver_blocked",
      reason: formatFreezeLoginReason(driver.freeze_reason, driver.frozen_until ?? todayYmd),
    };
  }
  if (driver.status === "suspended") {
    return { ok: false, error: "driver_suspended" };
  }
  if (driver.status !== "active") {
    return { ok: false, error: "driver_not_active" };
  }
  return { ok: true, user_id: driver.id, driver_code: driver.driver_code };
}

/** Pre-freeze lookup (no freeze columns). Used to prove a NULL window is a no-op. */
export function resolvePasscodeLookupLegacy(driver: PasscodeLookupDriver): PasscodeLookupResult {
  return resolvePasscodeLookup(
    { ...driver, frozen_from: null, frozen_until: null, freeze_reason: null },
    "1970-01-01",
  );
}
