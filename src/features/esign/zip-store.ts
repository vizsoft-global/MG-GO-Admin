/**
 * A minimal ZIP writer, `STORE` method only.
 *
 * `Sent for signature` needs one archive of every signed document in a batch.
 * The obvious move is a dependency, and that was measured rather than assumed:
 * the only zip libraries in `node_modules` (`fflate`, `archiver`, `jszip`) are
 * there *transitively* through `exceljs`, so leaning on one would break the day
 * a transitive bump drops it. The two honest options were to declare a new
 * direct dependency or to write the sixty lines that a `STORE` archive actually
 * is — and the second one wins on the merits, not only on tidiness.
 *
 * **Why `STORE` and not deflate.** Everything that goes into this archive is a
 * PDF, and a PDF's streams are already deflated inside the file. Compressing it
 * again recovers on the order of a percent while adding a compressor, its
 * memory profile, and a whole class of "the archive is subtly malformed because
 * the compressor streamed wrong" bugs — for a download an operator opens once.
 * The RFC's `STORE` method is a flat concatenation with a CRC, which is small
 * enough to be obviously correct and to be covered by a test that reads the
 * bytes back.
 *
 * **What this deliberately does not do.** No zip64 (a batch of signed PDFs
 * cannot reach 4 GiB), no encryption, no directory entries, no data descriptors
 * (sizes are known before the header is written because every document is
 * buffered), and no per-entry compression. Each omission is called out here so
 * the next person can tell a scope decision from an oversight.
 */

/** CRC-32 (IEEE 802.3) — the checksum ZIP requires for every entry. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = {
  /** Path inside the archive. Forward slashes; callers sanitise what they pass. */
  name: string;
  bytes: Uint8Array;
};

/**
 * MS-DOS packed date/time, which is what a ZIP header carries.
 *
 * ZIP has no timezone field, so the timestamp is written as the local wall
 * clock the caller hands in. That is the format's limitation rather than a
 * simplification here: unzip tools print exactly what is stored.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = date.getFullYear();
  // DOS epoch is 1980; anything earlier cannot be represented and is clamped
  // rather than wrapping into a nonsense year.
  const dosYear = Math.max(0, year - 1980);
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const packed = (dosYear << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: packed };
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
/** `UTF-8` filename flag — a rider's name is not guaranteed to be ASCII. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
/** 2.0 — the version that introduced folder support and `STORE`. */
const VERSION = 20;

class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, value & 0xffff, true);
    this.push(b);
  }

  u32(value: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value >>> 0, true);
    this.push(b);
  }

  get size(): number {
    return this.length;
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * Build one `STORE` archive from already-buffered entries.
 *
 * Deterministic: the same entries and the same `options.date` produce byte-
 * identical output, which is what lets the test assert a round trip rather than
 * "it is roughly a zip".
 */
export function buildZipStore(entries: ZipEntry[], options: { date?: Date } = {}): Uint8Array {
  const stamp = dosDateTime(options.date ?? new Date());
  const encoder = new TextEncoder();
  const body = new ByteWriter();
  const central = new ByteWriter();

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const checksum = crc32(entry.bytes);
    // The offset of *this* entry's local header, needed by the central
    // directory. Read before the header is appended, so it is the start of the
    // header rather than of the file data.
    const localOffset = body.size;

    body.u32(LOCAL_HEADER_SIGNATURE);
    body.u16(VERSION);
    body.u16(FLAG_UTF8);
    body.u16(METHOD_STORE);
    body.u16(stamp.time);
    body.u16(stamp.date);
    body.u32(checksum);
    // `STORE` means compressed and uncompressed sizes are identical, so the
    // two fields are written from one value rather than from a compressor's
    // report of what it produced.
    body.u32(entry.bytes.length);
    body.u32(entry.bytes.length);
    body.u16(nameBytes.length);
    body.u16(0);
    body.push(nameBytes);
    body.push(entry.bytes);

    central.u32(CENTRAL_HEADER_SIGNATURE);
    // "version made by" — 20 with the host byte 0 (MS-DOS/FAT), which is what
    // every tool writes.
    central.u16(VERSION);
    central.u16(VERSION);
    central.u16(FLAG_UTF8);
    central.u16(METHOD_STORE);
    central.u16(stamp.time);
    central.u16(stamp.date);
    central.u32(checksum);
    central.u32(entry.bytes.length);
    central.u32(entry.bytes.length);
    central.u16(nameBytes.length);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(0);
    central.u32(localOffset);
    central.push(nameBytes);
  }

  const centralOffset = body.size;
  const end = new ByteWriter();
  end.u32(EOCD_SIGNATURE);
  end.u16(0);
  end.u16(0);
  end.u16(entries.length);
  end.u16(entries.length);
  end.u32(central.size);
  end.u32(centralOffset);
  end.u16(0);

  const out = new Uint8Array(body.size + central.size + end.size);
  out.set(body.concat(), 0);
  out.set(central.concat(), body.size);
  out.set(end.concat(), body.size + central.size);
  return out;
}
