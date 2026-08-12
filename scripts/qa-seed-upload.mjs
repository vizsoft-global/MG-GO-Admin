/**
 * Uploads a real one-page PDF and a signature PNG into the esign-documents bucket so the
 * signed-copy path can be exercised with genuine bytes. QA-only; the objects live under
 * demo-qa/ and are removed with the rest of the tagged seed.
 *
 *   node scripts/qa-seed-upload.mjs
 */
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) throw new Error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

const pdf = (title, lines) => {
  const body = [`BT /F1 16 Tf 72 720 Td (${title}) Tj ET`]
    .concat(lines.map((l, i) => `BT /F1 11 Tf 72 ${680 - i * 18} Td (${l}) Tj ET`))
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
};

/**
 * Builds a real 8-bit RGB PNG from scratch: the composer feeds the signature straight into
 * pdf-lib's `embedPng`, and a byte-wise plausible but structurally invalid PNG takes the edge
 * worker down with WORKER_RESOURCE_LIMIT rather than a clean error. So every chunk here is
 * properly deflated and CRC'd. Draws a diagonal stroke so the stamp is visible in the output.
 */
const signaturePng = (width = 160, height = 48) => {
  const raw = Buffer.alloc((width * 3 + 1) * height, 0xff);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0; // filter byte: none
  }
  const ink = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const at = y * (width * 3 + 1) + 1 + x * 3;
    raw[at] = 0x1f;
    raw[at + 1] = 0x2d;
    raw[at + 2] = 0x4e;
  };
  for (let x = 0; x < width; x += 1) {
    const y = Math.round(height / 2 + Math.sin((x / width) * Math.PI * 3) * (height / 3));
    ink(x, y);
    ink(x, y + 1);
  }

  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crcTarget = Buffer.concat([head.subarray(4), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(crcTarget), 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE_PNG = signaturePng();

const upload = async (key, body, contentType) => {
  const res = await fetch(`${URL_BASE}/storage/v1/object/esign-documents/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      apikey: KEY,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body,
  });
  console.log(`${res.status} ${key} (${body.length} bytes)`, res.ok ? "" : await res.text());
};

await upload(
  "demo-qa/leave-policy.pdf",
  pdf("Annual Leave Policy - QA sample", [
    "This document exists so the signed-copy composer can be exercised",
    "with real bytes. It is QA seed data and carries no policy meaning.",
    "Signature is stamped on the last page, bottom-right.",
  ]),
  "application/pdf",
);
await upload(
  "demo-qa/vehicle-handover.pdf",
  pdf("Vehicle Handover Acknowledgement - QA sample", [
    "QA seed document for the pending e-signature request.",
  ]),
  "application/pdf",
);
await upload("demo-qa/signature.png", SIGNATURE_PNG, "image/png");
