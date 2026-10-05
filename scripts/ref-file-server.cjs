const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = process.argv[2] || process.cwd();
const PORT = Number(process.argv[3] || 8899);
const TYPES = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".html": "text/html",
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    const filePath = path.join(ROOT, url);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "content-type": TYPES[ext] || "application/octet-stream",
        "content-length": data.length,
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      });
      res.end(data);
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}`);
  });
