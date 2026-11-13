/**
 * Cloudflare half of the usage monitor: what a window of usage costs in a month.
 *
 * Unlike Firestore, Cloudflare's developer-platform prices are one public list
 * for every region, so they are constants here rather than editable fields.
 * Source: the Workers, Durable Objects and R2 pricing pages (Workers Paid plan).
 */

import { perDayAtRate } from "./usage-forecast";

export const CLOUDFLARE_PRICES = {
  /** Workers Paid minimum, charged whatever the usage. */
  baseMonthly: 5,
  workerRequestsIncluded: 10_000_000,
  workerRequestsPerMillion: 0.3,
  workerCpuMsIncluded: 30_000_000,
  workerCpuMsPerMillion: 0.02,
  doRequestsIncluded: 1_000_000,
  doRequestsPerMillion: 0.15,
  /** Incoming WebSocket messages bill as one request per twenty. */
  doWebsocketRatio: 20,
  doDurationGbsIncluded: 400_000,
  doDurationPerMillionGbs: 12.5,
  doRowsReadIncluded: 25_000_000_000,
  doRowsReadPerMillion: 0.001,
  doRowsWrittenIncluded: 50_000_000,
  doRowsWrittenPerMillion: 1,
  r2ClassAIncluded: 1_000_000,
  r2ClassAPerMillion: 4.5,
  r2ClassBIncluded: 10_000_000,
  r2ClassBPerMillion: 0.36,
  r2StorageGbIncluded: 10,
  r2StoragePerGbMonth: 0.015,
} as const;

const DAYS_PER_MONTH = 30;
const BYTES_PER_GB = 1_000_000_000;

/**
 * Usage inside one window. `null` means Cloudflare's analytics did not expose
 * that figure, which is different from zero: the forecast leaves the line out
 * and the page says so, instead of printing a confident $0.
 */
export type CloudflareWindowUsage = {
  workerRequests: number;
  workerCpuMs: number | null;
  doRequests: number;
  doWebsocketMessages: number | null;
  doDurationGbs: number | null;
  doRowsRead: number | null;
  doRowsWritten: number | null;
  r2ClassA: number;
  r2ClassB: number;
};

export const EMPTY_CLOUDFLARE_USAGE: CloudflareWindowUsage = {
  workerRequests: 0,
  workerCpuMs: null,
  doRequests: 0,
  doWebsocketMessages: null,
  doDurationGbs: null,
  doRowsRead: null,
  doRowsWritten: null,
  r2ClassA: 0,
  r2ClassB: 0,
};

export type CloudflareMonthly = {
  base: number;
  workerRequests: number;
  workerCpu: number;
  doRequests: number;
  doDuration: number;
  doRows: number;
  r2Operations: number;
  r2Storage: number;
  total: number;
};

function overage(units: number, included: number, perMillion: number): number {
  return (Math.max(0, units - included) / 1_000_000) * perMillion;
}

function monthly(windowValue: number | null, hours: number): number {
  return perDayAtRate(windowValue ?? 0, hours) * DAYS_PER_MONTH;
}

/** Durable Object requests as billed: plain requests plus WebSocket messages at 20:1. */
export function billableDoRequests(usage: CloudflareWindowUsage): number {
  return (
    usage.doRequests + (usage.doWebsocketMessages ?? 0) / CLOUDFLARE_PRICES.doWebsocketRatio
  );
}

/** Monthly Cloudflare cost if every hour looked like this window. */
export function forecastCloudflareMonthly(
  usage: CloudflareWindowUsage,
  hours: number,
  storageBytes: number | null,
): CloudflareMonthly {
  const p = CLOUDFLARE_PRICES;
  const workerRequests = overage(
    monthly(usage.workerRequests, hours),
    p.workerRequestsIncluded,
    p.workerRequestsPerMillion,
  );
  const workerCpu = overage(
    monthly(usage.workerCpuMs, hours),
    p.workerCpuMsIncluded,
    p.workerCpuMsPerMillion,
  );
  const doRequests = overage(
    monthly(billableDoRequests(usage), hours),
    p.doRequestsIncluded,
    p.doRequestsPerMillion,
  );
  const doDuration = overage(
    monthly(usage.doDurationGbs, hours),
    p.doDurationGbsIncluded,
    p.doDurationPerMillionGbs,
  );
  const doRows =
    overage(monthly(usage.doRowsRead, hours), p.doRowsReadIncluded, p.doRowsReadPerMillion) +
    overage(
      monthly(usage.doRowsWritten, hours),
      p.doRowsWrittenIncluded,
      p.doRowsWrittenPerMillion,
    );
  const r2Operations =
    overage(monthly(usage.r2ClassA, hours), p.r2ClassAIncluded, p.r2ClassAPerMillion) +
    overage(monthly(usage.r2ClassB, hours), p.r2ClassBIncluded, p.r2ClassBPerMillion);
  // Storage is a level, not a rate: it costs the same whichever window is asked.
  const r2Storage =
    Math.max(0, (storageBytes ?? 0) / BYTES_PER_GB - p.r2StorageGbIncluded) *
    p.r2StoragePerGbMonth;

  const base = p.baseMonthly;
  return {
    base,
    workerRequests,
    workerCpu,
    doRequests,
    doDuration,
    doRows,
    r2Operations,
    r2Storage,
    total:
      base +
      workerRequests +
      workerCpu +
      doRequests +
      doDuration +
      doRows +
      r2Operations +
      r2Storage,
  };
}

const R2_CLASS_A = new Set([
  "ListBuckets",
  "PutBucket",
  "ListObjects",
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "LifecycleStorageTierTransition",
  "ListMultipartUploads",
  "UploadPart",
  "UploadPartCopy",
  "ListParts",
  "PutBucketEncryption",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
]);

const R2_FREE = new Set(["DeleteObject", "DeleteBucket", "AbortMultipartUpload"]);

/** Which R2 price class an operation falls in. Anything unlisted is a read (B). */
export function classifyR2Action(actionType: string): "A" | "B" | "free" {
  if (R2_CLASS_A.has(actionType)) return "A";
  if (R2_FREE.has(actionType)) return "free";
  return "B";
}
