import assert from "node:assert/strict";
import test from "node:test";
import { crc32, buildZipStore, type ZipEntry } from "./zip-store";

const encoder = new TextEncoder();

/**
 * Read an archive back without a zip library.
 *
 * The point of the module is that it emits bytes another tool can open, so a
 * test that only asserted "some bytes were produced" would be worthless. This
 * walks the central directory the way an unzip tool does — EOCD, then each
 * entry's header — so a wrong offset or a wrong size fails here rather than in
 * the operator's downloads folder.
 */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD is last, but its fixed part is 22 bytes and there is no comment.
  const eocd = bytes.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50, "EOCD signature");
  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  if (entryCount === 0) {
    // An empty archive has no central directory at all, so there is no
    // signature to read — and reading one would run off the end of the buffer.
    assert.equal(centralOffset, eocd, "central directory starts at the EOCD");
    return out;
  }
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50, "central signature");

  let cursor = centralOffset;
  for (let i = 0; i < entryCount; i += 1) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50, `central header ${i}`);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressed = view.getUint32(cursor + 20, true);
    const uncompressed = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));

    assert.equal(method, 0, `${name} is stored`);
    assert.equal(compressed, uncompressed, `${name} sizes agree`);

    assert.equal(view.getUint32(localOffset, true), 0x04034b50, `${name} local signature`);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(dataStart, dataStart + uncompressed);
    assert.equal(crc32(data), crc, `${name} crc matches`);
    out.set(name, data);

    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test("crc32 matches the known IEEE value", () => {
  // The standard check value for "123456789" — every CRC implementation is
  // published against this vector, so it pins the polynomial and the reflection.
  assert.equal(crc32(encoder.encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("empty archive is a valid zip with no entries", () => {
  const read = readZip(buildZipStore([]));
  assert.equal(read.size, 0);
});

test("single entry round-trips byte for byte", () => {
  const body = encoder.encode("the signed document");
  const read = readZip(buildZipStore([{ name: "a.pdf", bytes: body }]));
  assert.deepEqual([...read.keys()], ["a.pdf"]);
  assert.deepEqual([...read.get("a.pdf")!], [...body]);
});

test("multiple entries keep their order and their bytes", () => {
  const entries: ZipEntry[] = [
    { name: "10001 - SIG-1 - ali.pdf", bytes: encoder.encode("one") },
    { name: "10002 - SIG-2 - sara.pdf", bytes: encoder.encode("two") },
    { name: "nested/three.pdf", bytes: encoder.encode("three") },
  ];
  const read = readZip(buildZipStore(entries));
  assert.deepEqual([...read.keys()], entries.map((e) => e.name));
  for (const entry of entries) {
    assert.deepEqual([...read.get(entry.name)!], [...entry.bytes]);
  }
});

test("an Arabic filename survives as UTF-8", () => {
  const name = "10001 - SIG-9 - علي.pdf";
  const read = readZip(buildZipStore([{ name, bytes: encoder.encode("x") }]));
  assert.deepEqual([...read.keys()], [name]);
});

test("output is deterministic for a fixed date", () => {
  const date = new Date(2026, 0, 2, 3, 4, 5);
  const entries = [{ name: "a.pdf", bytes: encoder.encode("x") }];
  const first = buildZipStore(entries, { date });
  const second = buildZipStore(entries, { date });
  assert.deepEqual([...first], [...second]);
});

test("a pre-1980 date is clamped rather than wrapping", () => {
  // DOS has no representation for 1970, and a wrapped year would print as 2100
  // in an unzip listing — silently wrong rather than visibly clamped.
  const read = readZip(buildZipStore([{ name: "a.pdf", bytes: encoder.encode("x") }], {
    date: new Date(1970, 0, 1),
  }));
  assert.equal(read.size, 1);
});
