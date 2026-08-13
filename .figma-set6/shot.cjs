// Decodes the newest cursor CDP Page.captureScreenshot JSON dump into a PNG.
// Usage: node .figma-set6/shot.cjs <out-name>
const fs = require("fs");
const path = require("path");

const dir = "C:\\Users\\Admin\\.cursor\\browser-logs";
const out = process.argv[2] || "shot";

const newest = fs
  .readdirSync(dir)
  .filter((f) => f.includes("Page.captureScreenshot") && f.endsWith(".json"))
  .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)[0];

if (!newest) throw new Error("no screenshot dump found");

const raw = JSON.parse(fs.readFileSync(path.join(dir, newest.f), "utf8"));
const data = raw.data ?? raw.result?.data ?? raw.result?.result?.data;
if (!data) throw new Error("no data field in " + newest.f + " keys=" + Object.keys(raw));

const dest = path.join(__dirname, out.endsWith(".png") ? out : out + ".png");
fs.writeFileSync(dest, Buffer.from(data, "base64"));
console.log(dest, fs.statSync(dest).size, "from", newest.f);
