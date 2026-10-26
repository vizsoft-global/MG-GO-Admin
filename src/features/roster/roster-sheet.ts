/** Schedule Upload sheet → one shift per rider per Kuwait day. */

export type RosterShiftDraft = {
  driverKey: string;
  driverName: string;
  date: string;
  off: boolean;
  shiftType: "single" | "split";
  session1Start: string | null;
  session1End: string | null;
  session1EndDayOffset: number;
  session2Start: string | null;
  session2End: string | null;
  session2EndDayOffset: number;
  storeCc: string;
  storeName: string;
  notes: string;
  errors: string[];
  rows: number[];
};

const HEADER_ALIASES: Record<string, string> = {
  driverid: "driver",
  driver_id: "driver",
  "driver id": "driver",
  employeeid: "driver",
  "employee id": "driver",
  mgid: "driver",
  "mg id": "driver",
  drivername: "name",
  "driver name": "name",
  storecc: "cc",
  "store cc": "cc",
  storename: "store",
  "store name": "store",
  restaurant: "store",
  date: "date",
  day: "day",
  shiftno: "shift",
  "shift no": "shift",
  "shift no.": "shift",
  shift: "shift",
  starttime: "start",
  "start time": "start",
  endtime: "end",
  "end time": "end",
  endsnextday: "next",
  "ends next day": "next",
  off: "off",
  notes: "notes",
  note: "notes",
  zone: "zone",
};

function normHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function clockToHms(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad(value.getHours())}:${pad(value.getMinutes())}:00`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const fraction = value > 1 ? value % 1 : value;
    const total = Math.round(fraction * 24 * 60);
    const hours = Math.floor(total / 60) % 24;
    const minutes = total % 60;
    return `${pad(hours)}:${pad(minutes)}:00`;
  }
  const text = String(value).trim();
  const ampm = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)$/i);
  if (ampm) {
    let hours = Number(ampm[1]);
    const minutes = Number(ampm[2]);
    const mer = ampm[4].toLowerCase();
    if (mer === "pm" && hours < 12) hours += 12;
    if (mer === "am" && hours === 12) hours = 0;
    if (hours > 23 || minutes > 59) return null;
    return `${pad(hours)}:${pad(minutes)}:00`;
  }
  const plain = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!plain) return null;
  const hours = Number(plain[1]);
  const minutes = Number(plain[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}:00`;
}

export function cellToYmd(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return utc.toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (!dmy) return null;
  const a = Number(dmy[1]);
  const b = Number(dmy[2]);
  const day = a > 12 ? a : b > 12 ? b : a;
  const month = day === a ? b : a;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${dmy[3]}-${pad(month)}-${pad(day)}`;
}

function yes(value: unknown): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "yes" || text === "y" || text === "1" || text === "true" || text === "off";
}

function minutes(hms: string): number {
  const [h, m] = hms.split(":").map(Number);
  return h * 60 + m;
}

function offset(start: string, end: string, endsNextDay: boolean): number {
  if (endsNextDay) return 1;
  return minutes(end) <= minutes(start) ? 1 : 0;
}

export function parseRosterSheet(aoa: unknown[][]): { drafts: RosterShiftDraft[]; headerError: string | null } {
  if (aoa.length === 0) return { drafts: [], headerError: "empty" };
  const header = aoa[0].map(normHeader);
  const col = (key: string) => header.findIndex((cell) => HEADER_ALIASES[cell] === key);
  const driverCol = col("driver");
  const dateCol = col("date");
  if (driverCol < 0 || dateCol < 0) return { drafts: [], headerError: "missing_columns" };
  const nameCol = col("name");
  const ccCol = col("cc");
  const storeCol = col("store");
  const shiftCol = col("shift");
  const startCol = col("start");
  const endCol = col("end");
  const nextCol = col("next");
  const offCol = col("off");
  const notesCol = col("notes");

  const grouped = new Map<string, RosterShiftDraft>();
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    if (row.every((cell) => String(cell ?? "").trim() === "")) continue;
    const driverKey = String(row[driverCol] ?? "").trim();
    const date = cellToYmd(row[dateCol]);
    const errors: string[] = [];
    if (!driverKey) errors.push("missing_driver");
    if (!date) errors.push("bad_date");
    const off = offCol >= 0 && yes(row[offCol]);
    const shiftNo = shiftCol >= 0 ? Number(String(row[shiftCol] ?? "").trim()) : 1;
    const start = startCol >= 0 ? clockToHms(row[startCol]) : null;
    const end = endCol >= 0 ? clockToHms(row[endCol]) : null;
    const endsNext = nextCol >= 0 && yes(row[nextCol]);
    if (!off && (!start || !end)) errors.push("bad_time");
    if (!off && shiftCol >= 0 && shiftNo !== 1 && shiftNo !== 2) errors.push("bad_shift_no");
    const key = `${driverKey}|${date ?? `row-${i + 1}`}`;
    let draft = grouped.get(key);
    if (!draft) {
      draft = {
        driverKey,
        driverName: nameCol >= 0 ? String(row[nameCol] ?? "").trim() : "",
        date: date ?? "",
        off,
        shiftType: "single",
        session1Start: null,
        session1End: null,
        session1EndDayOffset: 0,
        session2Start: null,
        session2End: null,
        session2EndDayOffset: 0,
        storeCc: ccCol >= 0 ? String(row[ccCol] ?? "").trim() : "",
        storeName: storeCol >= 0 ? String(row[storeCol] ?? "").trim() : "",
        notes: notesCol >= 0 ? String(row[notesCol] ?? "").trim() : "",
        errors: [],
        rows: [],
      };
      grouped.set(key, draft);
    }
    draft.rows.push(i + 1);
    draft.errors.push(...errors);
    if (notesCol >= 0 && String(row[notesCol] ?? "").trim()) {
      draft.notes = [draft.notes, String(row[notesCol]).trim()].filter(Boolean).join(" · ");
    }
    if (off && (start || end)) draft.errors.push("off_and_work");
    if (off) {
      draft.off = true;
      continue;
    }
    if (draft.off) draft.errors.push("off_and_work");
    const slot = shiftNo === 2 ? 2 : 1;
    if (slot === 1 && draft.session1Start) draft.errors.push("duplicate_shift");
    if (slot === 2 && draft.session2Start) draft.errors.push("duplicate_shift");
    if (start && end) {
      if (slot === 2) {
        draft.shiftType = "split";
        draft.session2Start = start;
        draft.session2End = end;
        draft.session2EndDayOffset = offset(start, end, endsNext);
      } else {
        draft.session1Start = start;
        draft.session1End = end;
        draft.session1EndDayOffset = offset(start, end, endsNext);
      }
    }
  }
  const drafts = [...grouped.values()];
  for (const draft of drafts) {
    if (!draft.off && draft.shiftType === "split" && !draft.session1Start) {
      draft.errors.push("missing_shift_1");
    }
    draft.errors = [...new Set(draft.errors)];
  }
  return { drafts, headerError: null };
}

/** Area Coaches / restaurant sheet: Store Name + Zone. */
export function parseRestaurantZoneSheet(aoa: unknown[][]): Array<{ row: number; store: string; zone: string }> {
  if (aoa.length === 0) return [];
  const header = aoa[0].map(normHeader);
  const storeCol = header.findIndex((cell) => HEADER_ALIASES[cell] === "store");
  const zoneCol = header.findIndex((cell) => HEADER_ALIASES[cell] === "zone");
  if (storeCol < 0 || zoneCol < 0) return [];
  const rows: Array<{ row: number; store: string; zone: string }> = [];
  for (let i = 1; i < aoa.length; i++) {
    const store = String(aoa[i]?.[storeCol] ?? "").trim();
    const zone = String(aoa[i]?.[zoneCol] ?? "").trim();
    if (!store && !zone) continue;
    rows.push({ row: i + 1, store, zone });
  }
  return rows;
}
