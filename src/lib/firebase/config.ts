import type { App } from "firebase-admin/app";
import { resolveFirebaseAdminCredentials } from "./credentials";

export type FirebaseAdminConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export function getFirebaseAdminConfig(): FirebaseAdminConfig | null {
  return resolveFirebaseAdminCredentials();
}

export function isFirebaseConfigured(): boolean {
  return getFirebaseAdminConfig() !== null;
}

export type FirebaseAdminContext = {
  app: App;
};
