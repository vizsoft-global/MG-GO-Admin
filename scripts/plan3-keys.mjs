#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const file = resolve("C:/Users/Admin/Desktop/Vizsoft/dpd-plan3-dump/jsonl/partners.jsonl");
const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  console.log(Object.keys(JSON.parse(line)).join(","));
  break;
}
