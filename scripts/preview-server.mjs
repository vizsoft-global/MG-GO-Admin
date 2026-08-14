/**
 * Throwaway static server used to preview marker artwork in a browser.
 *
 * The browser tool refuses file:// URLs, and marker design decisions (does the sprite
 * point north, is it legible at 40px, does the status colour survive) can only be made
 * by looking at pixels. Serves one directory, read-only, on localhost.
 *
 * Usage: node scripts/preview-server.mjs <dir> [port]
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 8099);

const TYPES = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
};

createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(
    /^(\.\.[/\\])+/,
    "",
  );
  const file = join(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`preview server: http://127.0.0.1:${port}/ serving ${root}`);
});
