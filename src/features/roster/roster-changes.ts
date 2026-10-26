import { FieldValue, type Firestore } from "firebase-admin/firestore";

export const ROSTER_CHANGES = "roster_changes";

export type RosterChangeStatus = "waiting" | "approved" | "rejected";

export type RosterChangeView = {
  id: string;
  driverId: string;
  driverName: string;
  employeeId: string;
  date: string;
  status: RosterChangeStatus;
  beforeStart: string | null;
  beforeEnd: string | null;
  beforeOff: boolean;
  beforeRestaurantId: string | null;
  afterStart: string | null;
  afterEnd: string | null;
  afterOff: boolean;
  afterRestaurantId: string | null;
  restaurantName: string;
  zoneId: string | null;
  endsNextDay: boolean;
  reason: string;
  requestedByName: string;
  decidedByName: string | null;
};

export type ApprovedOverlay = {
  off: boolean;
  start: string | null;
  end: string | null;
  endsNextDay: boolean;
  restaurantId: string | null;
  approvedByName: string;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function applyApprovedShift<T extends Record<string, unknown>>(shift: T, change: ApprovedOverlay | null): T {
  if (!change) return shift;
  return {
    ...shift,
    is_off: change.off,
    restaurant_id: change.restaurantId ?? shift.restaurant_id,
    session1_start: change.off ? null : change.start,
    session1_end: change.off ? null : change.end,
    session1_end_day_offset: change.endsNextDay ? 1 : 0,
    session2_start: null,
    session2_end: null,
    shift_type: "single",
  };
}

function viewOf(id: string, data: Record<string, unknown>): RosterChangeView {
  const status = str(data.status);
  return {
    id,
    driverId: str(data.driver_id),
    driverName: str(data.driver_name),
    employeeId: str(data.employee_id),
    date: str(data.date),
    status: status === "approved" || status === "rejected" ? status : "waiting",
    beforeStart: str(data.before_start) || null,
    beforeEnd: str(data.before_end) || null,
    beforeOff: data.before_off === true,
    beforeRestaurantId: str(data.before_restaurant_id) || null,
    afterStart: str(data.after_start) || null,
    afterEnd: str(data.after_end) || null,
    afterOff: data.after_off === true,
    afterRestaurantId: str(data.after_restaurant_id) || null,
    restaurantName: str(data.restaurant_name),
    zoneId: str(data.zone_id) || null,
    endsNextDay: data.ends_next_day === true,
    reason: str(data.reason),
    requestedByName: str(data.requested_by_name),
    decidedByName: str(data.decided_by_name) || null,
  };
}

export function approvedOverlay(change: RosterChangeView | null): ApprovedOverlay | null {
  if (!change || change.status !== "approved") return null;
  return {
    off: change.afterOff,
    start: change.afterStart,
    end: change.afterEnd,
    endsNextDay: change.endsNextDay,
    restaurantId: change.afterRestaurantId,
    approvedByName: change.decidedByName || change.requestedByName,
  };
}

export async function approvedByDriver(db: Firestore, day: string): Promise<Map<string, ApprovedOverlay>> {
  const snap = await db.collection(ROSTER_CHANGES).where("date", "==", day).limit(2000).get();
  const map = new Map<string, ApprovedOverlay>();
  for (const doc of snap.docs) {
    const view = viewOf(doc.id, doc.data());
    const overlay = approvedOverlay(view);
    if (overlay && view.driverId) map.set(view.driverId, overlay);
  }
  return map;
}

export async function countApprovedChanges(db: Firestore, dates: string[]): Promise<number> {
  const unique = [...new Set(dates)].slice(0, 30);
  if (unique.length === 0) return 0;
  const snap = await db.collection(ROSTER_CHANGES).where("date", "in", unique).limit(2000).get();
  return snap.docs.filter((doc) => doc.data().status === "approved").length;
}

export async function listRosterChanges(db: Firestore): Promise<RosterChangeView[]> {
  const snap = await db.collection(ROSTER_CHANGES).limit(300).get();
  return snap.docs
    .map((doc) => viewOf(doc.id, doc.data()))
    .sort((a, b) => (a.status === "waiting" ? 0 : 1) - (b.status === "waiting" ? 0 : 1) || b.date.localeCompare(a.date));
}

export async function createRosterChange(
  db: Firestore,
  input: Omit<RosterChangeView, "id" | "status" | "decidedByName"> & { requestedBy: string },
): Promise<{ id: string }> {
  const ref = db.collection(ROSTER_CHANGES).doc();
  await ref.set({
    driver_id: input.driverId,
    driver_name: input.driverName,
    employee_id: input.employeeId,
    date: input.date,
    status: "waiting",
    before_start: input.beforeStart,
    before_end: input.beforeEnd,
    before_off: input.beforeOff,
    before_restaurant_id: input.beforeRestaurantId,
    after_start: input.afterOff ? null : input.afterStart,
    after_end: input.afterOff ? null : input.afterEnd,
    after_off: input.afterOff,
    after_restaurant_id: input.afterRestaurantId,
    restaurant_name: input.restaurantName,
    zone_id: input.zoneId,
    ends_next_day: input.endsNextDay,
    reason: input.reason,
    requested_by: input.requestedBy,
    requested_by_name: input.requestedByName,
    requested_at: FieldValue.serverTimestamp(),
    decided_by: null,
    decided_by_name: null,
    decided_at: null,
  });
  return { id: ref.id };
}

export async function decideRosterChangeDoc(
  db: Firestore,
  id: string,
  status: "approved" | "rejected",
  actorId: string,
  actorName: string,
): Promise<{ ok: true } | { error: "not_found" }> {
  const ref = db.collection(ROSTER_CHANGES).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { error: "not_found" };
  await ref.set(
    {
      status,
      decided_by: actorId,
      decided_by_name: actorName,
      decided_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { ok: true };
}
