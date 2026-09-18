/** Recurring weekday template — `slot_date` is null, `day_of_week` is set. */
export type RecurringVisitSlot = {
  id?: string;
  branch_id: string | null;
  department_key: string;
  slot_date: string | null;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  capacity: number;
  is_active: boolean;
};

export type VisitBranchForCopy = {
  id: string;
  is_default: boolean;
  is_active: boolean;
};

export function normalizeVisitTime(value: string): string {
  return value.slice(0, 5);
}

export function isRecurringWeekdaySlot(slot: RecurringVisitSlot): boolean {
  return (
    slot.slot_date == null &&
    slot.day_of_week != null &&
    slot.day_of_week >= 0 &&
    slot.day_of_week <= 6 &&
    Boolean(slot.department_key) &&
    slot.is_active
  );
}

export function weekdaySlotMatchKey(slot: {
  department_key: string;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
}): string {
  return [
    slot.department_key,
    slot.day_of_week ?? "",
    normalizeVisitTime(slot.start_time),
    normalizeVisitTime(slot.end_time),
  ].join("|");
}

export function nextDefaultBranchUpdates(
  branches: readonly VisitBranchForCopy[],
  targetId: string,
):
  | { ok: true; already: true }
  | { ok: true; already: false; clearIds: string[] }
  | { ok: false; error: "not_found" } {
  const target = branches.find((b) => b.id === targetId);
  if (!target) return { ok: false, error: "not_found" };
  if (target.is_default) return { ok: true, already: true };
  return {
    ok: true,
    already: false,
    clearIds: branches.filter((b) => b.is_default && b.id !== targetId).map((b) => b.id),
  };
}

/** Prefer the current default; if it has no recurring slots, use the richest branch. */
export function pickSlotCopySource(
  branches: readonly VisitBranchForCopy[],
  slots: readonly RecurringVisitSlot[],
): string | null {
  const recurring = slots.filter(isRecurringWeekdaySlot);
  const countByBranch = new Map<string, number>();
  for (const slot of recurring) {
    if (!slot.branch_id) continue;
    countByBranch.set(slot.branch_id, (countByBranch.get(slot.branch_id) ?? 0) + 1);
  }

  const defaultBranch = branches.find((b) => b.is_default);
  if (defaultBranch && (countByBranch.get(defaultBranch.id) ?? 0) > 0) {
    return defaultBranch.id;
  }

  let bestId: string | null = null;
  let bestCount = 0;
  for (const [id, count] of countByBranch) {
    if (count > bestCount) {
      bestId = id;
      bestCount = count;
    }
  }
  return bestId;
}

export type VisitSlotInsert = {
  branch_id: string;
  department_key: string;
  slot_date: null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  capacity: number;
  is_active: true;
};

/**
 * Copy recurring weekday templates onto every other active branch.
 * Skips a target that already has the same dept / dow / start / end.
 * Never reads or writes `visit_bookings`.
 */
export function planVisitWeekdaySlotCopy(
  branches: readonly VisitBranchForCopy[],
  slots: readonly RecurringVisitSlot[],
  sourceBranchId?: string | null,
): { sourceBranchId: string | null; inserts: VisitSlotInsert[] } {
  const sourceId = sourceBranchId ?? pickSlotCopySource(branches, slots);
  if (!sourceId) return { sourceBranchId: null, inserts: [] };

  const sourceSlots = slots.filter(
    (s) => s.branch_id === sourceId && isRecurringWeekdaySlot(s),
  );
  const targets = branches.filter((b) => b.is_active && b.id !== sourceId);
  const inserts: VisitSlotInsert[] = [];

  for (const target of targets) {
    const existing = new Set(
      slots
        .filter((s) => s.branch_id === target.id && isRecurringWeekdaySlot(s))
        .map((s) => weekdaySlotMatchKey(s)),
    );
    for (const slot of sourceSlots) {
      const key = weekdaySlotMatchKey(slot);
      if (existing.has(key)) continue;
      existing.add(key);
      inserts.push({
        branch_id: target.id,
        department_key: slot.department_key,
        slot_date: null,
        day_of_week: slot.day_of_week as number,
        start_time: slot.start_time,
        end_time: slot.end_time,
        capacity: slot.capacity,
        is_active: true,
      });
    }
  }

  return { sourceBranchId: sourceId, inserts };
}
