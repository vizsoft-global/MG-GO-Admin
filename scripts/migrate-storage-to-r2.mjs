#!/usr/bin/env node
/**
 * One-off: copy objects from Supabase Storage to Cloudflare R2.
 *
 * Requires in .env.local (or env):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *   optional R2_S3_ENDPOINT
 *
 * Usage: node scripts/migrate-storage-to-r2.mjs [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

function loadEnvFile() {
  const path = resolve(root, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET_NAME;

if (!supabaseUrl || !serviceKey || !accountId || !accessKeyId || !secretAccessKey || !bucket) {
  console.error("Missing required env vars. See script header.");
  process.exit(1);
}

const endpoint =
  process.env.R2_S3_ENDPOINT?.trim() ||
  `https://${accountId}.r2.cloudflarestorage.com`;

const supabase = createClient(supabaseUrl, serviceKey);
const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

function mapDriverIntakeKey(supabasePath) {
  return `drivers/intakes/${supabasePath}`;
}

function mapPartnerLogoKey(supabasePath) {
  const parts = supabasePath.split("/");
  const partnerId = parts[0];
  const file = parts.slice(1).join("/") || "logo.png";
  return `partners/${partnerId}/${file}`;
}

async function listAll(bucketId, prefix = "") {
  const out = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabase.storage.from(bucketId).list(prefix, {
      limit,
      offset,
    });
    if (error) throw error;
    if (!data?.length) break;
    for (const item of data) {
      if (item.id === null && item.name) {
        const nested = await listAll(bucketId, prefix ? `${prefix}/${item.name}` : item.name);
        out.push(...nested);
      } else if (item.name) {
        out.push(prefix ? `${prefix}/${item.name}` : item.name);
      }
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return out;
}

async function migrateBucket(supabaseBucket, mapKey) {
  console.log(`\n=== ${supabaseBucket} ===`);
  const paths = await listAll(supabaseBucket);
  console.log(`Found ${paths.length} object(s)`);

  for (const path of paths) {
    const r2Key = mapKey(path);
    console.log(`  ${path} -> ${r2Key}`);
    if (dryRun) continue;

    const { data, error } = await supabase.storage.from(supabaseBucket).download(path);
    if (error) {
      console.error(`    download failed: ${error.message}`);
      continue;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: r2Key,
        Body: buffer,
        ContentType: data.type || "application/octet-stream",
      }),
    );
  }
}

async function migratePartnerLogoUrls() {
  console.log("\n=== partners.logo_url column ===");
  const { data: partners, error } = await supabase
    .from("partners")
    .select("id, logo_url")
    .not("logo_url", "is", null);

  if (error) throw error;

  for (const p of partners ?? []) {
    const url = p.logo_url;
    if (!url || typeof url !== "string") continue;
    if (!url.includes("/storage/v1/object/public/partner-logos/")) continue;

    const marker = "/partner-logos/";
    const idx = url.indexOf(marker);
    if (idx === -1) continue;
    const rest = url.slice(idx + marker.length).split("?")[0];
    const key = mapPartnerLogoKey(rest);

    console.log(`  ${p.id}: ${url.slice(0, 60)}... -> ${key}`);
    if (dryRun) continue;

    await supabase.from("partners").update({ logo_url: key }).eq("id", p.id);
  }
}

async function main() {
  console.log(dryRun ? "DRY RUN" : "LIVE MIGRATION");
  await migrateBucket("driver-intakes", mapDriverIntakeKey);
  await migrateBucket("partner-logos", mapPartnerLogoKey);
  await migratePartnerLogoUrls();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
