import type { DriverDocumentType } from "@/features/drivers/types";

export type DocumentExpiryBucket = "expired" | "week" | "month" | "quarter";

export type DocumentExpiryRow = {
  id: string;
  bucket: DocumentExpiryBucket;
  docType: DriverDocumentType;
  expiresAt: string;
  daysUntil: number;
  driverId: string | null;
  intakeId: string | null;
  driverName: string;
  driverCode: string;
  phone: string | null;
  objectKey: string | null;
  notifyEnabled: boolean;
  notifyLeadDays: number[];
};

export type DocumentExpirySummary = {
  expired: number;
  week: number;
  month: number;
  quarter: number;
};

export function kuwaitToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function daysUntilExpiry(expiresAt: string, today = kuwaitToday()): number {
  return Math.round(
    (new Date(`${expiresAt.slice(0, 10)}T00:00:00`).getTime() -
      new Date(`${today}T00:00:00`).getTime()) /
      86_400_000,
  );
}

export function bucketDocumentExpiryRow(
  expiresAt: string,
  today = kuwaitToday(),
): DocumentExpiryBucket | null {
  const days = daysUntilExpiry(expiresAt, today);
  if (days < 0) return "expired";
  if (days <= 7) return "week";
  if (days <= 30) return "month";
  if (days <= 90) return "quarter";
  return null;
}

export const DOCUMENT_EXPIRY_BUCKETS: DocumentExpiryBucket[] = [
  "expired",
  "week",
  "month",
  "quarter",
];
