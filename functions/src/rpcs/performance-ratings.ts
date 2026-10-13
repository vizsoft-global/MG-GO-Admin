import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Query,
  type QueryDocumentSnapshot,
} from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { requireStaff, type StaffContext } from "../core/staff";
import {
  isoTimestamp,
  loadDocMap,
  numberOrNull,
  pick,
  pickId,
  pickTriBool,
  textOrNull,
  type Dict,
} from "./_shared";

const PERFORMANCE_RATING_TEAMS = "performance_rating_teams";

const MONTH_RE = /^(\d{4})-(\d{2})(?:-\d{2})?/;

function dataOf(request: { data?: unknown }): Dict {
  const value = request.data;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Dict)
    : {};
}

/** First candidate that is present at all; unlike `pick`, `""` is a value. */
function firstDefined(data: Dict, ...names: string[]): unknown {
  for (const name of names) {
    const value = data[name];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function rawString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** `NULLIF(btrim(x), '')`. */
function trimmedOrNull(value: unknown): string | null {
  return textOrNull(value);
}

function currentKuwaitMonth(): string {
  return `${kuwaitDayString(new Date()).slice(0, 7)}-01`;
}

/** `date_trunc('month', COALESCE(p, Kuwait today))`. */
function periodMonthOf(data: Dict): string {
  const raw = pick(data, "periodMonth", "p_period_month");
  if (typeof raw === "string") {
    const match = MONTH_RE.exec(raw.trim());
    if (match) return `${match[1]}-${match[2]}-01`;
  }
  if (raw instanceof Timestamp || raw instanceof Date) {
    const at = raw instanceof Timestamp ? raw.toDate() : raw;
    if (!Number.isNaN(at.getTime())) return `${kuwaitDayString(at).slice(0, 7)}-01`;
  }
  return currentKuwaitMonth();
}

function assertNotFuture(month: string): void {
  if (month > currentKuwaitMonth()) {
    throw new HttpsError("invalid-argument", "future_period");
  }
}

function hasRatePermission(staff: StaffContext): boolean {
  return staff.isSuperAdmin || staff.permissionSlugs.has("performance.rate");
}

async function loadTeam(teamKey: string): Promise<Dict | null> {
  const db = getFirestore();
  const byId = await db.collection(PERFORMANCE_RATING_TEAMS).doc(teamKey).get();
  if (byId.exists) return (byId.data() ?? {}) as Dict;
  const byKey = await db
    .collection(PERFORMANCE_RATING_TEAMS)
    .where("key", "==", teamKey)
    .limit(1)
    .get();
  return byKey.empty ? null : ((byKey.docs[0].data() ?? {}) as Dict);
}

/** The Firestore form of `staff_rates_for_team`: super admin, or a listed member. */
async function staffRatesForTeam(staff: StaffContext, teamKey: string): Promise<boolean> {
  if (staff.isSuperAdmin) return true;
  const snap = await getFirestore()
    .collection(COLLECTIONS.performanceRatingTeamMembers)
    .where("team_key", "==", teamKey)
    .where("profile_id", "==", staff.uid)
    .limit(1)
    .get();
  return !snap.empty;
}

async function findOne(
  collection: string,
  filters: Array<[string, unknown]>,
): Promise<QueryDocumentSnapshot | null> {
  let query: Query = getFirestore().collection(collection);
  for (const [field, value] of filters) query = query.where(field, "==", value);
  const snap = await query.limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

function slugKey(value: string): string | null {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug === "" ? null : slug;
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

export const adminUpsertDriverPerformanceRating = onCall(async (request) => {
  const staff = await requireStaff(request, "performance.rate");
  const db = getFirestore();
  const data = dataOf(request);

  const driverId = pickId(data, "driverId", "p_driver_id");
  const criterionId = pickId(data, "criterionId", "p_criterion_id");

  let teamKey: string | null = null;
  if (criterionId) {
    const criterionSnap = await db
      .collection(COLLECTIONS.performanceRatingCriteria)
      .doc(criterionId)
      .get();
    const criterion = criterionSnap.exists ? ((criterionSnap.data() ?? {}) as Dict) : null;
    if (criterion && criterion.is_active === true) {
      const key = textOrNull(criterion.team_key);
      const team = key ? await loadTeam(key) : null;
      if (key && team && team.is_active === true) teamKey = key;
    }
  }
  if (!criterionId || !teamKey) throw new HttpsError("not-found", "unknown_criterion");

  if (!(await staffRatesForTeam(staff, teamKey))) {
    throw new HttpsError("permission-denied", "not_team_member");
  }

  const rawScore = numberOrNull(pick(data, "score", "p_score"));
  const score = rawScore === null ? null : Math.trunc(rawScore);
  if (score === null || score < 1 || score > 5) {
    throw new HttpsError("invalid-argument", "invalid_score");
  }

  const driverSnap = driverId
    ? await db.collection(COLLECTIONS.drivers).doc(driverId).get()
    : null;
  if (!driverId || !driverSnap?.exists || driverSnap.get(FIELDS.drivers.archivedAt)) {
    throw new HttpsError("not-found", "driver_not_found");
  }

  const month = periodMonthOf(data);
  assertNotFuture(month);

  const ratedAt = new Date();
  const ratingId = await db.runTransaction(async (tx) => {
    const existing = await tx.get(
      db
        .collection(COLLECTIONS.driverPerformanceRatings)
        .where("driver_id", "==", driverId)
        .where("criterion_id", "==", criterionId)
        .where("period_month", "==", month)
        .limit(1),
    );
    const patch = {
      score,
      rated_by: staff.uid,
      rated_at: Timestamp.fromDate(ratedAt),
      updated_at: FieldValue.serverTimestamp(),
    };
    if (!existing.empty) {
      tx.update(existing.docs[0].ref, patch);
      return existing.docs[0].id;
    }
    const ref = db
      .collection(COLLECTIONS.driverPerformanceRatings)
      .doc(`${driverId}_${criterionId}_${month}`);
    tx.set(ref, {
      driver_id: driverId,
      criterion_id: criterionId,
      period_month: month,
      ...patch,
    });
    return ref.id;
  });

  return {
    id: ratingId,
    driver_id: driverId,
    criterion_id: criterionId,
    team_key: teamKey,
    period_month: month,
    score,
    rated_by: staff.uid,
    rated_at: ratedAt.toISOString(),
  };
});

export const adminSetDriverPerformanceRatingNote = onCall(async (request) => {
  const staff = await requireStaff(request, "performance.rate");
  const db = getFirestore();
  const data = dataOf(request);

  const driverId = pickId(data, "driverId", "p_driver_id");
  const teamKey = pickId(data, "teamKey", "p_team_key");

  const team = teamKey ? await loadTeam(teamKey) : null;
  if (!teamKey || !team || team.is_active !== true) {
    throw new HttpsError("not-found", "unknown_team");
  }

  if (!(await staffRatesForTeam(staff, teamKey))) {
    throw new HttpsError("permission-denied", "not_team_member");
  }

  const month = periodMonthOf(data);
  assertNotFuture(month);

  const comment = trimmedOrNull(firstDefined(data, "comment", "p_comment"));

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(
      db
        .collection(COLLECTIONS.driverPerformanceRatingNotes)
        .where("driver_id", "==", driverId)
        .where("team_key", "==", teamKey)
        .where("period_month", "==", month),
    );

    if (comment === null) {
      for (const doc of existing.docs) tx.delete(doc.ref);
      return;
    }

    const patch = {
      comment,
      authored_by: staff.uid,
      updated_at: FieldValue.serverTimestamp(),
    };
    if (!existing.empty) {
      tx.update(existing.docs[0].ref, patch);
      return;
    }
    tx.set(
      db
        .collection(COLLECTIONS.driverPerformanceRatingNotes)
        .doc(`${driverId ?? "none"}_${teamKey}_${month}`),
      { driver_id: driverId, team_key: teamKey, period_month: month, ...patch },
    );
  });

  return { comment };
});

type CriterionRow = {
  id: string;
  team_key: string;
  key: string;
  label_en: string;
  label_ar: string;
  weight: number;
  sort_order: number;
  is_active: boolean;
};

type RatingRow = {
  criterion_id: string;
  score: number | null;
  rated_at: Date | null;
  rated_by: string | null;
};

function asDate(value: unknown): Date | null {
  const iso = isoTimestamp(value);
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const adminListDriverPerformanceRatings = onCall(async (request) => {
  const staff = await requireStaff(request, "performance.view");
  const db = getFirestore();
  const data = dataOf(request);

  const driverId = pickId(data, "driverId", "p_driver_id");
  const month = periodMonthOf(data);
  const canRate = hasRatePermission(staff);

  const [teamsSnap, criteriaSnap, ratingsSnap, notesSnap, membershipSnap] = await Promise.all([
    db.collection(PERFORMANCE_RATING_TEAMS).get(),
    db.collection(COLLECTIONS.performanceRatingCriteria).get(),
    driverId
      ? db
          .collection(COLLECTIONS.driverPerformanceRatings)
          .where("driver_id", "==", driverId)
          .where("period_month", "==", month)
          .get()
      : Promise.resolve(null),
    driverId
      ? db
          .collection(COLLECTIONS.driverPerformanceRatingNotes)
          .where("driver_id", "==", driverId)
          .where("period_month", "==", month)
          .get()
      : Promise.resolve(null),
    staff.isSuperAdmin
      ? Promise.resolve(null)
      : db
          .collection(COLLECTIONS.performanceRatingTeamMembers)
          .where("profile_id", "==", staff.uid)
          .get(),
  ]);

  const memberTeams = new Set<string>(
    (membershipSnap?.docs ?? [])
      .map((doc) => textOrNull(doc.get("team_key")))
      .filter((key): key is string => key !== null),
  );

  const criteria: CriterionRow[] = criteriaSnap.docs.map((doc) => {
    const raw = doc.data();
    return {
      id: doc.id,
      team_key: textOrNull(raw.team_key) ?? "",
      key: textOrNull(raw.key) ?? "",
      label_en: rawString(raw.label_en) ?? "",
      label_ar: rawString(raw.label_ar) ?? "",
      weight: numberOrNull(raw.weight) ?? 0,
      sort_order: numberOrNull(raw.sort_order) ?? 0,
      is_active: raw.is_active === true,
    };
  });
  const criterionTeam = new Map(criteria.map((row) => [row.id, row.team_key]));

  const ratings = new Map<string, RatingRow>();
  for (const doc of ratingsSnap?.docs ?? []) {
    const raw = doc.data();
    const criterionId = textOrNull(raw.criterion_id);
    if (!criterionId) continue;
    ratings.set(criterionId, {
      criterion_id: criterionId,
      score: numberOrNull(raw.score),
      rated_at: asDate(raw.rated_at),
      rated_by: textOrNull(raw.rated_by),
    });
  }

  const notes = new Map<string, Dict>();
  for (const doc of notesSnap?.docs ?? []) {
    const key = textOrNull(doc.get("team_key"));
    if (key) notes.set(key, doc.data() as Dict);
  }

  const profileIds: string[] = [];
  for (const rating of ratings.values()) if (rating.rated_by) profileIds.push(rating.rated_by);
  for (const note of notes.values()) {
    const author = textOrNull(note.authored_by);
    if (author) profileIds.push(author);
  }
  const profiles = await loadDocMap(COLLECTIONS.profiles, profileIds);
  const nameOf = (id: string | null): string | null =>
    id ? (textOrNull(profiles.get(id)?.full_name) ?? null) : null;

  const teams = teamsSnap.docs
    .map((doc) => {
      const raw = doc.data();
      return {
        key: textOrNull(raw.key) ?? doc.id,
        label_en: rawString(raw.label_en) ?? "",
        label_ar: rawString(raw.label_ar) ?? "",
        weight: numberOrNull(raw.weight) ?? 0,
        sort_order: numberOrNull(raw.sort_order) ?? 0,
        is_active: raw.is_active === true,
      };
    })
    .filter((team) => team.is_active)
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));

  const rows = teams.map((team) => {
    const teamCriteria = criteria
      .filter((row) => row.team_key === team.key && row.is_active)
      .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));

    let weighted = 0;
    let weightSum = 0;
    let lastRatedAt: Date | null = null;
    for (const criterion of teamCriteria) {
      const rating = ratings.get(criterion.id);
      if (!rating) continue;
      if (rating.score !== null) {
        weighted += criterion.weight * rating.score;
        weightSum += criterion.weight;
      }
      if (rating.rated_at && (!lastRatedAt || rating.rated_at > lastRatedAt)) {
        lastRatedAt = rating.rated_at;
      }
    }

    let lastRater: RatingRow | null = null;
    for (const rating of ratings.values()) {
      if (criterionTeam.get(rating.criterion_id) !== team.key) continue;
      const at = rating.rated_at?.getTime() ?? -Infinity;
      const best = lastRater?.rated_at?.getTime() ?? -Infinity;
      if (!lastRater || at > best) lastRater = rating;
    }

    const note = notes.get(team.key) ?? null;

    return {
      team_key: team.key,
      label_en: team.label_en,
      label_ar: team.label_ar,
      weight: team.weight,
      can_edit: canRate && (staff.isSuperAdmin || memberTeams.has(team.key)),
      comment: note ? textOrNull(note.comment) : null,
      comment_at: note ? isoTimestamp(note.updated_at) : null,
      comment_by_name: note ? nameOf(textOrNull(note.authored_by)) : null,
      score: weightSum > 0 ? Math.round((weighted / weightSum) * 100) / 100 : null,
      rated_at: lastRatedAt ? lastRatedAt.toISOString() : null,
      rated_by_name: lastRater ? nameOf(lastRater.rated_by) : null,
      criteria: teamCriteria.map((criterion) => {
        const rating = ratings.get(criterion.id) ?? null;
        return {
          criterion_id: criterion.id,
          key: criterion.key,
          label_en: criterion.label_en,
          label_ar: criterion.label_ar,
          weight: criterion.weight,
          score: rating?.score ?? null,
          rated_at: rating?.rated_at ? rating.rated_at.toISOString() : null,
        };
      }),
    };
  });

  return { driver_id: driverId, period_month: month, teams: rows };
});

// ---------------------------------------------------------------------------
// Team membership and criteria (settings surface)
// ---------------------------------------------------------------------------

export const adminSetPerformanceTeamMember = onCall(async (request) => {
  const staff = await requireStaff(request, "performance.manage_teams");
  const db = getFirestore();
  const data = dataOf(request);

  const teamKey = pickId(data, "teamKey", "p_team_key");
  const profileId = pickId(data, "profileId", "p_profile_id");
  const member = pickTriBool(data, "member", "p_member") ?? false;

  if (!teamKey || !(await loadTeam(teamKey))) {
    throw new HttpsError("not-found", "unknown_team");
  }

  const profileSnap = profileId
    ? await db.collection(COLLECTIONS.profiles).doc(profileId).get()
    : null;
  const profile = profileSnap?.exists ? ((profileSnap.data() ?? {}) as Dict) : null;
  if (
    !profileId ||
    !profile ||
    profile[FIELDS.profiles.role] !== "staff" ||
    profile[FIELDS.profiles.approvalStatus] !== "approved" ||
    !profile[FIELDS.profiles.adminRoleId]
  ) {
    throw new HttpsError("failed-precondition", "not_staff");
  }

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(
      db
        .collection(COLLECTIONS.performanceRatingTeamMembers)
        .where("team_key", "==", teamKey)
        .where("profile_id", "==", profileId),
    );
    if (member) {
      if (!existing.empty) return;
      tx.set(
        db.collection(COLLECTIONS.performanceRatingTeamMembers).doc(`${teamKey}_${profileId}`),
        {
          team_key: teamKey,
          profile_id: profileId,
          created_by: staff.uid,
          created_at: FieldValue.serverTimestamp(),
        },
      );
      return;
    }
    for (const doc of existing.docs) tx.delete(doc.ref);
  });

  return { team_key: teamKey, member };
});

export const adminUpsertPerformanceRatingCriterion = onCall(async (request) => {
  await requireStaff(request, "performance.manage_teams");
  const db = getFirestore();
  const data = dataOf(request);

  const id = pickId(data, "id", "p_id");
  const teamKey = pickId(data, "teamKey", "p_team_key");
  const labelEn = trimmedOrNull(firstDefined(data, "labelEn", "label_en", "p_label_en"));
  const labelAr = trimmedOrNull(firstDefined(data, "labelAr", "label_ar", "p_label_ar"));
  const weightIn = numberOrNull(pick(data, "weight", "p_weight"));
  const sortIn = numberOrNull(pick(data, "sortOrder", "sort_order", "p_sort_order"));
  const sortOrderIn = sortIn === null ? null : Math.trunc(sortIn);
  const isActiveIn = pickTriBool(data, "isActive", "is_active", "p_is_active");

  if (id) {
    const ref = db.collection(COLLECTIONS.performanceRatingCriteria).doc(id);
    const row = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "unknown_criterion");
      const current = (snap.data() ?? {}) as Dict;
      const next = {
        label_en: labelEn ?? rawString(current.label_en) ?? "",
        label_ar: labelAr ?? rawString(current.label_ar) ?? "",
        weight: Math.max(weightIn ?? numberOrNull(current.weight) ?? 0, 0),
        sort_order: sortOrderIn ?? numberOrNull(current.sort_order) ?? 0,
        is_active: isActiveIn ?? current.is_active === true,
      };
      tx.update(ref, next);
      return {
        id,
        team_key: textOrNull(current.team_key),
        key: textOrNull(current.key),
        ...next,
      };
    });
    return row;
  }

  if (!teamKey || !(await loadTeam(teamKey))) {
    throw new HttpsError("not-found", "unknown_team");
  }

  const keySource =
    rawString(firstDefined(data, "key", "p_key")) ??
    rawString(firstDefined(data, "labelEn", "label_en", "p_label_en")) ??
    "";
  const key = slugKey(keySource);
  if (!key) throw new HttpsError("invalid-argument", "key_required");

  const row = {
    team_key: teamKey,
    key,
    label_en: labelEn ?? key,
    label_ar: labelAr ?? labelEn ?? key,
    weight: Math.max(weightIn ?? 1, 0),
    sort_order: sortOrderIn ?? 0,
    is_active: isActiveIn ?? true,
  };

  const newRef: DocumentReference = db.collection(COLLECTIONS.performanceRatingCriteria).doc();
  await db.runTransaction(async (tx) => {
    const duplicate = await tx.get(
      db
        .collection(COLLECTIONS.performanceRatingCriteria)
        .where("team_key", "==", teamKey)
        .where("key", "==", key)
        .limit(1),
    );
    if (!duplicate.empty) throw new HttpsError("already-exists", "duplicate_key");
    tx.set(newRef, { ...row, created_at: FieldValue.serverTimestamp() });
  });

  return { id: newRef.id, ...row };
});

export const adminDeletePerformanceRatingCriterion = onCall(async (request) => {
  await requireStaff(request, "performance.manage_teams");
  const db = getFirestore();
  const data = dataOf(request);

  const id = pickId(data, "id", "p_id");
  if (id) {
    const used = await findOne(COLLECTIONS.driverPerformanceRatings, [["criterion_id", id]]);
    if (used) throw new HttpsError("failed-precondition", "criterion_in_use");
    await db.collection(COLLECTIONS.performanceRatingCriteria).doc(id).delete();
  }

  return { deleted: 1 };
});
