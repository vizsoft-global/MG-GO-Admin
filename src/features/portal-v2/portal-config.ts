export const PORTAL_SECTION_KEYS = [
  "riderStatus",
  "leavePlan",
  "newRiders",
  "contractFill",
  "onLeaveNow",
  "turnover",
  "employeesDocs",
] as const;

export const PORTAL_DOC_KEYS = [
  "civilId",
  "drivingLicence",
  "vehicleRegistration",
  "vehicleInsurance",
  "healthCertificate",
  "clientOnboarding",
  "passport",
  "employmentContract",
  "salaryBank",
] as const;

export type PortalSectionKey = (typeof PORTAL_SECTION_KEYS)[number];
export type PortalDocKey = (typeof PORTAL_DOC_KEYS)[number];
export type PortalUserRole = "admin" | "viewer";

export type PortalUserRow = {
  id: string;
  name: string;
  email: string;
  role: PortalUserRole;
};

export type PortalConfig = {
  projectKey: string;
  clientName: string;
  clientCode: string;
  accountManager: string;
  contractedHeadcount: number;
  contractStart: string;
  contractEnd: string;
  logoUrl: string;
  status: "draft" | "active";
  sections: Record<PortalSectionKey, boolean>;
  documents: Record<PortalDocKey, boolean>;
  maskCivilId: boolean;
  allowDownloads: boolean;
  allowBulk: boolean;
  watermark: boolean;
  users: PortalUserRow[];
  twoStep: boolean;
  idleSignOut: boolean;
  updatedAt: string;
};

const PROJECT_KEYS = ["keeta", "americana", "unassigned"] as const;

export function emptyPortalConfig(projectKey = ""): PortalConfig {
  return {
    projectKey,
    clientName: "",
    clientCode: "",
    accountManager: "",
    contractedHeadcount: 0,
    contractStart: "",
    contractEnd: "",
    logoUrl: "",
    status: "draft",
    sections: {
      riderStatus: true,
      leavePlan: true,
      newRiders: true,
      contractFill: true,
      onLeaveNow: true,
      turnover: false,
      employeesDocs: true,
    },
    documents: {
      civilId: true,
      drivingLicence: true,
      vehicleRegistration: true,
      vehicleInsurance: true,
      healthCertificate: true,
      clientOnboarding: true,
      passport: false,
      employmentContract: false,
      salaryBank: false,
    },
    maskCivilId: true,
    allowDownloads: true,
    allowBulk: false,
    watermark: true,
    users: [],
    twoStep: true,
    idleSignOut: true,
    updatedAt: "",
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function ymd(value: unknown): string {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10)) ? raw.slice(0, 10) : "";
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Math.max(0, Math.round(Number(value)));
  }
  return 0;
}

function readUsers(value: unknown): PortalUserRow[] {
  if (!Array.isArray(value)) return [];
  const rows: PortalUserRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const email = text(row.email);
    if (!email) continue;
    rows.push({
      id: text(row.id) || email.toLowerCase(),
      name: text(row.name) || email,
      email,
      role: row.role === "viewer" ? "viewer" : "admin",
    });
  }
  return rows.slice(0, 50);
}

export function normalizePortalConfig(projectKey: string, raw: unknown): PortalConfig {
  const base = emptyPortalConfig(projectKey);
  if (!raw || typeof raw !== "object") return base;
  const row = raw as Record<string, unknown>;
  const sections = (row.sections ?? {}) as Record<string, unknown>;
  const documents = (row.documents ?? {}) as Record<string, unknown>;
  const next: PortalConfig = {
    ...base,
    clientName: text(row.client_name),
    clientCode: text(row.client_code),
    accountManager: text(row.account_manager),
    contractedHeadcount: num(row.contracted_headcount),
    contractStart: ymd(row.contract_start),
    contractEnd: ymd(row.contract_end),
    logoUrl: text(row.logo_url),
    status: row.status === "active" ? "active" : "draft",
    users: readUsers(row.users),
    twoStep: flag(row.two_step, base.twoStep),
    idleSignOut: flag(row.idle_sign_out, base.idleSignOut),
    maskCivilId: flag(row.mask_civil_id, base.maskCivilId),
    allowDownloads: flag(row.allow_downloads, base.allowDownloads),
    allowBulk: flag(row.allow_bulk, base.allowBulk),
    watermark: flag(row.watermark, base.watermark),
    updatedAt: text(row.updated_at),
  };
  for (const key of PORTAL_SECTION_KEYS) {
    next.sections[key] = flag(sections[key], base.sections[key]);
  }
  for (const key of PORTAL_DOC_KEYS) {
    next.documents[key] = flag(documents[key], base.documents[key]);
  }
  return next;
}

export function isPortalProjectKey(value: string): boolean {
  return (PROJECT_KEYS as readonly string[]).includes(value.trim().toLowerCase());
}
