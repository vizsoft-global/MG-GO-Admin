#!/usr/bin/env node
/**
 * Publish an Android APK to Cloudflare R2 and register/activate in app_releases.
 *
 * Requires in .env.local (or env):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *   optional R2_S3_ENDPOINT, ADMIN_EMAIL (sets released_by)
 *
 * Usage:
 *   npm run publish:apk -- --apk path/to/app-release.apk --pubspec path/to/pubspec.yaml --channel internal --activate
 *   npm run publish:apk -- list --channel production
 *   npm run publish:apk -- --apk path/to/app.apk --version-name 1.0.10 --version-code 11 --dry-run
 */

import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const MAX_APK_BYTES = 100 * 1024 * 1024;
const VALID_CHANNELS = new Set(["production", "beta", "internal"]);
const APK_CONTENT_TYPE = "application/vnd.android.package-archive";

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

function parseArgs(argv) {
  const args = {
    command: "publish",
    apk: null,
    pubspec: null,
    versionName: null,
    versionCode: null,
    channel: "internal",
    releaseNotes: null,
    minSupported: null,
    required: false,
    activate: false,
    dryRun: false,
  };

  let i = 0;
  if (argv[i] === "list") {
    args.command = "list";
    i = 1;
  }

  while (i < argv.length) {
    const flag = argv[i];
    const next = argv[i + 1];

    switch (flag) {
      case "list":
        args.command = "list";
        i += 1;
        break;
      case "--apk":
        args.apk = next;
        i += 2;
        break;
      case "--pubspec":
        args.pubspec = next;
        i += 2;
        break;
      case "--version-name":
        args.versionName = next;
        i += 2;
        break;
      case "--version-code":
        args.versionCode = next;
        i += 2;
        break;
      case "--channel":
        args.channel = next;
        i += 2;
        break;
      case "--release-notes":
        args.releaseNotes = next;
        i += 2;
        break;
      case "--min-supported":
        args.minSupported = next;
        i += 2;
        break;
      case "--required":
        args.required = true;
        i += 1;
        break;
      case "--activate":
        args.activate = true;
        i += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
        i += 1;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${flag}`);
        printHelp();
        process.exit(1);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run publish:apk -- --apk <path> [options]
  npm run publish:apk -- list [--channel internal|beta|production]

Publish options:
  --apk <path>           Path to .apk file (required for publish)
  --pubspec <path>       Parse version from pubspec.yaml (version: 1.0.10+11)
  --version-name <name>  e.g. 1.0.10 (required if no --pubspec)
  --version-code <int>   e.g. 11 (required if no --pubspec)
  --channel <name>       production | beta | internal (default: internal)
  --release-notes <text> Optional release notes
  --min-supported <int>  Optional minimum supported version code
  --required             Mark as required update
  --activate             Set as active release after upload
  --dry-run              Validate only, no writes

List options:
  --channel <name>       Filter channel (default: internal)

Env (.env.local):
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
  optional: R2_S3_ENDPOINT, ADMIN_EMAIL`);
}

function parsePubspecVersion(content) {
  const match = content.match(/^version:\s*([^\s#]+)/m);
  if (!match) {
    throw new Error("Could not find version: line in pubspec.yaml");
  }
  const raw = match[1].trim();
  const plus = raw.indexOf("+");
  if (plus === -1) {
    throw new Error(`pubspec version must use name+code format, got: ${raw}`);
  }
  const versionName = raw.slice(0, plus).trim();
  const versionCode = parseInt(raw.slice(plus + 1).trim(), 10);
  if (!versionName) throw new Error("pubspec version name is empty");
  if (!Number.isFinite(versionCode) || versionCode <= 0) {
    throw new Error(`Invalid pubspec version code: ${raw.slice(plus + 1)}`);
  }
  return { versionName, versionCode };
}

function buildAppReleaseApkKey(channel, versionCode) {
  return `releases/android/${channel}/musallam-${versionCode}.apk`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function step(label) {
  console.log(`→ ${label}`);
}

async function hashFileSha256(filePath) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolvePromise(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function loadClients() {
  loadEnvFile();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  const missing = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!accountId) missing.push("R2_ACCOUNT_ID");
  if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!bucket) missing.push("R2_BUCKET_NAME");

  if (missing.length > 0) {
    console.error("Missing required env vars in .env.local:");
    for (const key of missing) console.error(`  - ${key}`);
    process.exit(1);
  }

  const endpoint =
    process.env.R2_S3_ENDPOINT?.trim() ||
    `https://${accountId}.r2.cloudflarestorage.com`;

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  return { supabase, s3, bucket };
}

async function resolveReleasedBy(supabase) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    console.warn(`Warning: could not resolve ADMIN_EMAIL (${error.message})`);
    return null;
  }
  if (!data?.id) {
    console.warn(`Warning: ADMIN_EMAIL not found in profiles: ${email}`);
    return null;
  }
  return data.id;
}

async function getLatestVersionCode(supabase, channel) {
  const { data, error } = await supabase
    .from("app_releases")
    .select("version_code")
    .eq("platform", "android")
    .eq("channel", channel)
    .order("version_code", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? Number(data.version_code) : 0;
}

async function headR2Object(s3, bucket, key) {
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { exists: true, size: res.ContentLength };
  } catch (e) {
    const err = e;
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return { exists: false };
    }
    throw e;
  }
}

async function deleteR2Object(s3, bucket, key) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

function resolveMetadata(args) {
  let versionName = args.versionName;
  let versionCode =
    args.versionCode != null ? parseInt(String(args.versionCode), 10) : NaN;

  if (args.pubspec) {
    const pubspecPath = resolve(args.pubspec);
    if (!existsSync(pubspecPath)) {
      throw new Error(`pubspec not found: ${pubspecPath}`);
    }
    const parsed = parsePubspecVersion(readFileSync(pubspecPath, "utf8"));
    if (!versionName) versionName = parsed.versionName;
    if (!Number.isFinite(versionCode)) versionCode = parsed.versionCode;
  }

  if (!versionName?.trim()) {
    throw new Error("missing_version_name — use --version-name or --pubspec");
  }
  if (!Number.isFinite(versionCode) || versionCode <= 0) {
    throw new Error("invalid_version_code — use --version-code or --pubspec");
  }

  const channel = String(args.channel ?? "internal").trim();
  if (!VALID_CHANNELS.has(channel)) {
    throw new Error(`invalid_channel — must be production, beta, or internal`);
  }

  let minSupportedVersionCode = null;
  if (args.minSupported != null && String(args.minSupported).trim() !== "") {
    minSupportedVersionCode = parseInt(String(args.minSupported), 10);
    if (!Number.isFinite(minSupportedVersionCode) || minSupportedVersionCode <= 0) {
      throw new Error("invalid_min_supported_version_code");
    }
  }

  return {
    versionName: versionName.trim(),
    versionCode,
    channel,
    releaseNotes: args.releaseNotes?.trim() || null,
    minSupportedVersionCode,
    isRequired: args.required,
    objectKey: buildAppReleaseApkKey(channel, versionCode),
  };
}

function validateApk(apkPath) {
  const resolved = resolve(apkPath);
  if (!existsSync(resolved)) {
    throw new Error(`APK not found: ${resolved}`);
  }
  if (!resolved.toLowerCase().endsWith(".apk")) {
    throw new Error("invalid_extension — file must be .apk");
  }
  const { size } = statSync(resolved);
  if (size <= 0) throw new Error("missing_apk — file is empty");
  if (size > MAX_APK_BYTES) {
    throw new Error(`file_too_large — max ${formatBytes(MAX_APK_BYTES)}`);
  }
  return { path: resolved, sizeBytes: size };
}

async function cmdList(args) {
  const { supabase } = loadClients();
  const channel = String(args.channel ?? "internal").trim();
  if (!VALID_CHANNELS.has(channel)) {
    throw new Error(`invalid_channel — must be production, beta, or internal`);
  }

  const { data, error } = await supabase
    .from("app_releases")
    .select(
      "id, version_name, version_code, is_active, is_required, released_at, apk_size_bytes",
    )
    .eq("platform", "android")
    .eq("channel", channel)
    .order("version_code", { ascending: false });

  if (error) throw new Error(error.message);

  if (!data?.length) {
    console.log(`No releases on channel "${channel}".`);
    return;
  }

  console.log(`Releases on channel "${channel}":\n`);
  console.log(
    "CODE".padEnd(6) +
      "VERSION".padEnd(12) +
      "ACTIVE".padEnd(8) +
      "REQ".padEnd(5) +
      "SIZE".padEnd(10) +
      "RELEASED",
  );
  console.log("-".repeat(60));

  for (const row of data) {
    const released = new Date(row.released_at).toISOString().slice(0, 19).replace("T", " ");
    console.log(
      String(row.version_code).padEnd(6) +
        String(row.version_name).padEnd(12) +
        (row.is_active ? "yes" : "no").padEnd(8) +
        (row.is_required ? "yes" : "no").padEnd(5) +
        formatBytes(Number(row.apk_size_bytes)).padEnd(10) +
        released,
    );
  }
}

async function cmdPublish(args) {
  if (!args.apk) {
    console.error("Missing --apk <path>");
    printHelp();
    process.exit(1);
  }

  const { supabase, s3, bucket } = loadClients();
  const apk = validateApk(args.apk);
  const meta = resolveMetadata(args);

  step("validating");
  const latestCode = await getLatestVersionCode(supabase, meta.channel);
  if (meta.versionCode <= latestCode) {
    throw new Error(
      `version_code_not_higher — latest on ${meta.channel} is ${latestCode}, got ${meta.versionCode}`,
    );
  }

  const { data: duplicate } = await supabase
    .from("app_releases")
    .select("id")
    .eq("platform", "android")
    .eq("channel", meta.channel)
    .eq("version_code", meta.versionCode)
    .maybeSingle();

  if (duplicate) {
    throw new Error(`version_code_exists — ${meta.versionCode} already on ${meta.channel}`);
  }

  step("hashing");
  const apkSha256 = await hashFileSha256(apk.path);

  const plan = {
    apk: apk.path,
    channel: meta.channel,
    versionName: meta.versionName,
    versionCode: meta.versionCode,
    objectKey: meta.objectKey,
    sizeBytes: apk.sizeBytes,
    sha256: `${apkSha256.slice(0, 8)}…${apkSha256.slice(-8)}`,
    activate: args.activate,
    required: meta.isRequired,
    dryRun: args.dryRun,
  };

  console.log("\nPublish plan:");
  console.log(JSON.stringify(plan, null, 2));

  if (args.dryRun) {
    console.log("\nDry run — no changes made.");
    return;
  }

  step("uploading");
  const body = readFileSync(apk.path);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: meta.objectKey,
      Body: body,
      ContentType: APK_CONTENT_TYPE,
    }),
  );

  const head = await headR2Object(s3, bucket, meta.objectKey);
  if (!head.exists) {
    throw new Error("apk_not_found — upload verification failed");
  }

  step("registering");
  const releasedBy = await resolveReleasedBy(supabase);

  const { data: inserted, error: insertError } = await supabase
    .from("app_releases")
    .insert({
      platform: "android",
      channel: meta.channel,
      version_name: meta.versionName,
      version_code: meta.versionCode,
      min_supported_version_code: meta.minSupportedVersionCode,
      apk_object_key: meta.objectKey,
      apk_size_bytes: apk.sizeBytes,
      apk_sha256: apkSha256,
      release_notes: meta.releaseNotes,
      is_required: meta.isRequired,
      is_active: false,
      released_by: releasedBy,
    })
    .select("id")
    .single();

  if (insertError) {
    await deleteR2Object(s3, bucket, meta.objectKey).catch(() => undefined);
    if (insertError.code === "23505") {
      throw new Error(`version_code_exists — ${meta.versionCode}`);
    }
    throw new Error(insertError.message);
  }

  let isActive = false;

  if (args.activate) {
    step("activating");
    const releaseId = inserted.id;

    const { error: deactivateError } = await supabase
      .from("app_releases")
      .update({ is_active: false })
      .eq("platform", "android")
      .eq("channel", meta.channel)
      .neq("id", releaseId);

    if (deactivateError) throw new Error(deactivateError.message);

    const { error: activateError } = await supabase
      .from("app_releases")
      .update({ is_active: true })
      .eq("id", releaseId);

    if (activateError) throw new Error(activateError.message);
    isActive = true;
  }

  console.log("\nPublished successfully:");
  console.log(`  id:           ${inserted.id}`);
  console.log(`  channel:      ${meta.channel}`);
  console.log(`  version:      ${meta.versionName} (${meta.versionCode})`);
  console.log(`  object key:   ${meta.objectKey}`);
  console.log(`  sha256:       ${apkSha256.slice(0, 8)}…${apkSha256.slice(-8)}`);
  console.log(`  size:         ${formatBytes(apk.sizeBytes)}`);
  console.log(`  active:       ${isActive ? "yes" : "no (use --activate or admin UI)"}`);
  if (!isActive) {
    console.log(`\nDrivers will not receive this build until it is activated.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "list") {
    await cmdList(args);
    return;
  }

  await cmdPublish(args);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\nError: ${message}`);
  process.exit(1);
});
