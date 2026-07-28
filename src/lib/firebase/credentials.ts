import type { FirebaseAdminConfig } from "./config";

type ServiceAccountJson = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function normalizePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}

export function parseFirebaseServiceAccountJson(raw: string): FirebaseAdminConfig | null {
  try {
    const parsed = JSON.parse(raw) as ServiceAccountJson;
    const projectId = parsed.project_id?.trim();
    const clientEmail = parsed.client_email?.trim();
    const privateKeyRaw = parsed.private_key?.trim();
    if (!projectId || !clientEmail || !privateKeyRaw) return null;
    return {
      projectId,
      clientEmail,
      privateKey: normalizePrivateKey(privateKeyRaw),
    };
  } catch {
    return null;
  }
}

export function resolveFirebaseAdminCredentials(): FirebaseAdminConfig | null {
  const jsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonRaw) {
    const fromJson = parseFirebaseServiceAccountJson(jsonRaw);
    if (fromJson) return fromJson;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (!projectId || !clientEmail || !privateKeyRaw) return null;

  return {
    projectId,
    clientEmail,
    privateKey: normalizePrivateKey(privateKeyRaw),
  };
}
