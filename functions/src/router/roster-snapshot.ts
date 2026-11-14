/**
 * Shared store for a value every caller of a page builds the same way.
 *
 * `read-snapshot.ts` stores one handler *result* per (function, scope,
 * arguments). That cannot help the Employees list while its arguments change:
 * every search, sort, page and partner scope is a different document, and each
 * miss rebuilds the roster from about thirteen thousand documents. This module
 * stores the thing those results are all cut from — the pre-filter roster — once,
 * for every query, page, caller and instance.
 *
 * Nothing caller-specific may be stored here. Partner scoping and masking are
 * applied by the handler *after* the read, on each request.
 *
 * A read is one generation document plus one snapshot document (plus one read
 * per extra part when the packed value is larger than one document). Anything
 * unexpected — a missing part, a checksum that does not match, a value that
 * will not unpack, a failed read — is a miss, and the caller's `load` runs as
 * if this module did not exist. A value that cannot be stored (too large, or
 * holding something JSON would change) is simply not stored.
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";

/** Bytes of packed value per document. A Firestore document holds 1 MiB. */
export const ROSTER_PART_BYTES = 900_000;
/** Above this the value is not stored at all. */
export const ROSTER_MAX_PARTS = 8;

/** `DRIVER_ROSTER_SNAPSHOT=1` turns the stored roster on. Anything else is off. */
export function driverRosterSnapshotEnabled(): boolean {
  return process.env.DRIVER_ROSTER_SNAPSHOT === "1";
}

/**
 * Whether an instance's own copy may be served without reading the snapshot.
 *
 * The copy is only as good as the generation it was read under, so the caller
 * still reads the counter (one small document) on every request: an edit made
 * through another instance moves the counter, and this then answers no.
 */
export function rosterMemoUsable(
  entry: { generation?: number; freshUntil?: number } | undefined,
  generation: number,
  now: number,
): boolean {
  return (
    entry !== undefined &&
    entry.generation === generation &&
    typeof entry.freshUntil === "number" &&
    entry.freshUntil > now
  );
}

export type RosterPartDoc = {
  packed: Buffer;
  generation: number;
  /** Head document only. */
  freshUntil?: number;
  parts?: number;
  bytes?: number;
  sha?: string;
};

export type RosterStoreBackend = {
  generation: (name: string) => Promise<number>;
  read: (ids: readonly string[]) => Promise<(RosterPartDoc | null)[]>;
  /** All documents of one value, written together or not at all. */
  write: (docs: readonly { id: string; name: string; doc: RosterPartDoc }[]) => Promise<void>;
};

const DATE_TAG = "$rosterDate";

/**
 * A copy of `value` that JSON carries without loss, or `undefined` when there
 * is none. Dates are tagged so they come back as Dates. Anything else that
 * JSON would silently change (a Firestore Timestamp, a class instance, an
 * `undefined`, a non-finite number) makes the whole value unstorable, so a
 * stored roster can never differ from a freshly built one.
 */
export function encodeStorable(value: unknown): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : undefined;
    case "object":
      break;
    default:
      return undefined;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? undefined : { [DATE_TAG]: ms };
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const encoded = encodeStorable(item);
      if (encoded === undefined) return undefined;
      out.push(encoded);
    }
    return out;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === DATE_TAG) return undefined;
    const encoded = encodeStorable(item);
    if (encoded === undefined) return undefined;
    out[key] = encoded;
  }
  return out;
}

export function decodeStorable(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => decodeStorable(item));
  const record = value as Record<string, unknown>;
  const tagged = record[DATE_TAG];
  if (typeof tagged === "number" && Object.keys(record).length === 1) return new Date(tagged);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) out[key] = decodeStorable(item);
  return out;
}

export type PackedRoster = { chunks: Buffer[]; bytes: number; sha: string };

/** Gzip and cut into document-sized parts. `null` when it cannot be stored. */
export function packRoster(
  value: unknown,
  partBytes = ROSTER_PART_BYTES,
  maxParts = ROSTER_MAX_PARTS,
): PackedRoster | null {
  const encoded = encodeStorable(value);
  if (encoded === undefined) return null;
  let packed: Buffer;
  try {
    packed = gzipSync(Buffer.from(JSON.stringify(encoded)));
  } catch {
    return null;
  }
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < packed.length; offset += partBytes) {
    chunks.push(packed.subarray(offset, offset + partBytes));
  }
  if (chunks.length === 0 || chunks.length > maxParts) return null;
  return { chunks, bytes: packed.length, sha: createHash("sha256").update(packed).digest("hex") };
}

/** The value, or `undefined` when the parts are not exactly what was written. */
export function unpackRoster(chunks: readonly Buffer[], bytes: number, sha: string): unknown {
  try {
    const packed = Buffer.concat(chunks);
    if (packed.length !== bytes) return undefined;
    if (createHash("sha256").update(packed).digest("hex") !== sha) return undefined;
    return decodeStorable(JSON.parse(gunzipSync(packed).toString("utf8")) as unknown);
  } catch {
    return undefined;
  }
}

export function rosterDocId(name: string, generation: number, key: string): string {
  return createHash("sha256").update(`roster|${name}|${generation}|${key}`).digest("hex");
}

function partId(head: string, index: number): string {
  return index === 0 ? head : `${head}-p${index}`;
}

function asPacked(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function firestoreBackend(): RosterStoreBackend {
  const db = () => getFirestore();
  const snapshots = () => db().collection(COLLECTIONS.pageReadSnapshots);
  return {
    async generation(name) {
      const snap = await db().collection(COLLECTIONS.pageReadGenerations).doc("current").get();
      const value = snap.get(name);
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    },
    async read(ids) {
      if (ids.length === 0) return [];
      const snaps = await db().getAll(...ids.map((id) => snapshots().doc(id)));
      return snaps.map((snap) => {
        if (!snap.exists) return null;
        const packed = asPacked(snap.get("packed"));
        const generation = snap.get("generation");
        if (!packed || typeof generation !== "number") return null;
        const freshUntil = snap.get("fresh_until");
        const parts = snap.get("parts");
        const bytes = snap.get("bytes");
        const sha = snap.get("sha");
        return {
          packed,
          generation,
          freshUntil: typeof freshUntil === "number" ? freshUntil : undefined,
          parts: typeof parts === "number" ? parts : undefined,
          bytes: typeof bytes === "number" ? bytes : undefined,
          sha: typeof sha === "string" ? sha : undefined,
        };
      });
    },
    async write(docs) {
      const batch = db().batch();
      const expireAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60_000);
      for (const { id, name, doc } of docs) {
        const row: Record<string, unknown> = {
          fn: name,
          scope: "shared",
          generation: doc.generation,
          packed: doc.packed,
          expire_at: expireAt,
        };
        if (doc.freshUntil !== undefined) row["fresh_until"] = doc.freshUntil;
        if (doc.parts !== undefined) row["parts"] = doc.parts;
        if (doc.bytes !== undefined) row["bytes"] = doc.bytes;
        if (doc.sha !== undefined) row["sha"] = doc.sha;
        batch.set(snapshots().doc(id), row);
      }
      await batch.commit();
    },
  };
}

export type RosterReadOutcome = "hit" | "miss";

export type RosterRead<T> = {
  value: T;
  outcome: RosterReadOutcome;
  /** `null` when the generation could not be read; the value is then not stored. */
  generation: number | null;
  /** Until when this value may be reused without another snapshot read. */
  freshUntil: number;
  /** Store documents read for this call (generation + head + extra parts). */
  storeReads: number;
  /** Whether a miss managed to store what it loaded. */
  stored: boolean;
};

/** One read of the generation counter, or `null` when it failed. */
export async function rosterGeneration(
  name: string,
  backend: RosterStoreBackend = firestoreBackend(),
): Promise<number | null> {
  try {
    return await backend.generation(name);
  } catch {
    console.error(JSON.stringify({ perf: "roster-generation-failed", name }));
    return null;
  }
}

/**
 * Read `key` from the shared store, or run `load` and store what it returns.
 *
 * `generation` may be passed when the caller has already read it for this
 * request, so two values (the rows and the tile counts) share one read.
 */
export async function readThroughRoster<T>(
  input: {
    /** The generation counter's field in `page_read_generations/current`. */
    name: string;
    key: string;
    ttlMs: number;
    load: () => Promise<T>;
    generation?: number | null;
    now?: number;
    partBytes?: number;
    maxParts?: number;
  },
  backend: RosterStoreBackend = firestoreBackend(),
): Promise<RosterRead<T>> {
  const now = input.now ?? Date.now();
  let storeReads = 0;
  let generation: number | null = input.generation ?? null;
  if (input.generation === undefined) {
    generation = await rosterGeneration(input.name, backend);
    storeReads += 1;
  }

  if (generation !== null) {
    try {
      const head = rosterDocId(input.name, generation, input.key);
      const [first] = await backend.read([head]);
      storeReads += 1;
      if (
        first &&
        first.generation === generation &&
        typeof first.freshUntil === "number" &&
        first.freshUntil > now &&
        typeof first.parts === "number" &&
        first.parts >= 1 &&
        first.parts <= (input.maxParts ?? ROSTER_MAX_PARTS) &&
        typeof first.bytes === "number" &&
        typeof first.sha === "string"
      ) {
        const chunks: Buffer[] = [first.packed];
        let complete = true;
        if (first.parts > 1) {
          const ids = Array.from({ length: first.parts - 1 }, (_, index) => partId(head, index + 1));
          const rest = await backend.read(ids);
          storeReads += ids.length;
          for (const part of rest) {
            if (!part || part.generation !== generation) {
              complete = false;
              break;
            }
            chunks.push(part.packed);
          }
        }
        if (complete) {
          const value = unpackRoster(chunks, first.bytes, first.sha);
          if (value !== undefined) {
            return {
              value: value as T,
              outcome: "hit",
              generation,
              freshUntil: first.freshUntil,
              storeReads,
              stored: true,
            };
          }
        }
      }
    } catch {
      console.error(JSON.stringify({ perf: "roster-read-failed", name: input.name, key: input.key }));
    }
  }

  const value = await input.load();
  const freshUntil = now + input.ttlMs;
  let stored = false;
  if (generation !== null) {
    try {
      const packed = packRoster(value, input.partBytes, input.maxParts);
      if (packed) {
        const head = rosterDocId(input.name, generation, input.key);
        await backend.write(
          packed.chunks.map((chunk, index) => ({
            id: partId(head, index),
            name: input.name,
            doc:
              index === 0
                ? {
                    packed: chunk,
                    generation: generation as number,
                    freshUntil,
                    parts: packed.chunks.length,
                    bytes: packed.bytes,
                    sha: packed.sha,
                  }
                : { packed: chunk, generation: generation as number },
          })),
        );
        stored = true;
      } else {
        console.warn(JSON.stringify({ perf: "roster-not-storable", name: input.name, key: input.key }));
      }
    } catch {
      console.error(JSON.stringify({ perf: "roster-write-failed", name: input.name, key: input.key }));
    }
  }
  return { value, outcome: "miss", generation, freshUntil, storeReads, stored };
}
