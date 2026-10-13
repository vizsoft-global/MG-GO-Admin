#!/usr/bin/env node
/**
 * Plan 3 step 0: one consistent custom-format dump of auth + public.
 * Reads the linked pooler URL locally. Never prints the URL or password.
 * Output stays outside the git repo.
 */
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve("C:/Users/Admin/Desktop/Vizsoft/dpd-plan3-dump");
const outFile = resolve(outDir, "dpd-public-auth.dump");
const logPath = resolve(outDir, "pg_dump.log");

function redact(text, secret) {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

function connectionUrl(mode) {
  const raw = readFileSync(resolve(root, "supabase/.temp/pooler-url"), "utf8").trim();
  const url = new URL(raw);
  const password = decodeURIComponent(url.password);
  if (mode === "session-pooler" && url.port === "6543") url.port = "5432";
  if (mode === "direct") {
    url.hostname = "db.eoksxkdssptgyqyywdju.supabase.co";
    url.port = "5432";
    url.username = "postgres";
  }
  url.searchParams.set("sslmode", "require");
  return { href: url.toString(), password };
}

function runDump(href, password) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--schema=public",
        "--schema=auth",
        "--exclude-table=public._tmp_v_att_verify",
        `--file=${outFile}`,
        `--dbname=${href}`,
        "--verbose",
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    const log = createWriteStream(logPath, { flags: "a" });
    const onData = (buf) => {
      log.write(redact(buf.toString(), password));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      log.end();
      resolvePromise(code ?? 1);
    });
  });
}

mkdirSync(outDir, { recursive: true });
const started = new Date().toISOString();
console.log(`dump_dir=${outDir}`);
console.log(`started=${started}`);

let code = 1;
for (const mode of ["session-pooler", "direct"]) {
  console.log(`attempt=${mode}`);
  const { href, password } = connectionUrl(mode);
  code = await runDump(href, password);
  console.log(`attempt_exit=${mode} code=${code}`);
  if (code === 0) break;
}

console.log(code === 0 ? "dump_ok" : "dump_failed");
process.exit(code);
