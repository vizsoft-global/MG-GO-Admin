import { randomUUID } from "crypto";

export const DRIVER_UPLOAD_ENTITY_TYPES = [
  "driver_doc",
  "driver_selfie",
  "driver_avatar",
  "order_proof",
] as const;

export type DriverUploadEntityType = (typeof DRIVER_UPLOAD_ENTITY_TYPES)[number];

const ENTITY_RULES: Record<
  DriverUploadEntityType,
  { maxBytes: number; allowedMimePrefixes: string[] }
> = {
  driver_doc: {
    maxBytes: 10 * 1024 * 1024,
    allowedMimePrefixes: ["image/", "application/pdf"],
  },
  driver_selfie: {
    maxBytes: 5 * 1024 * 1024,
    allowedMimePrefixes: ["image/"],
  },
  driver_avatar: {
    maxBytes: 2 * 1024 * 1024,
    allowedMimePrefixes: ["image/"],
  },
  order_proof: {
    maxBytes: 10 * 1024 * 1024,
    allowedMimePrefixes: ["image/", "application/pdf"],
  },
};

export function isDriverUploadEntityType(
  value: string,
): value is DriverUploadEntityType {
  return (DRIVER_UPLOAD_ENTITY_TYPES as readonly string[]).includes(value);
}

export function validateDriverUploadRequest(params: {
  entityType: string;
  contentType: string;
  sizeBytes: number;
}):
  | { ok: true; entityType: DriverUploadEntityType }
  | { error: string } {
  if (!isDriverUploadEntityType(params.entityType)) {
    return { error: "invalid_entity_type" };
  }

  const rules = ENTITY_RULES[params.entityType];
  if (params.sizeBytes <= 0 || params.sizeBytes > rules.maxBytes) {
    return { error: "file_too_large" };
  }

  const ct = params.contentType.trim().toLowerCase();
  const allowed = rules.allowedMimePrefixes.some((prefix) =>
    ct.startsWith(prefix),
  );
  if (!allowed) {
    return { error: "invalid_content_type" };
  }

  return { ok: true, entityType: params.entityType };
}

function extensionFromFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "bin";
  return base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
}

export function buildDriverObjectKey(params: {
  driverId: string;
  entityType: DriverUploadEntityType;
  originalFilename: string;
}): string {
  const date = new Date().toISOString().slice(0, 10);
  const ext = extensionFromFilename(params.originalFilename);
  if (params.entityType === "driver_avatar") {
    return `driver-avatars/${params.driverId}/${date}/${randomUUID()}.${ext}`;
  }
  return `drivers/${params.driverId}/${params.entityType}/${date}/${randomUUID()}.${ext}`;
}
