import { getFirebaseAdminConfig } from "./config";

type FirebaseApp = import("firebase-admin/app").App;
type Messaging = import("firebase-admin/messaging").Messaging;

let cachedApp: FirebaseApp | null = null;
let cachedMessaging: Messaging | null = null;

export async function getFirebaseAdminApp(): Promise<FirebaseApp | null> {
  if (cachedApp) return cachedApp;

  const { getApps, initializeApp, cert } = await import("firebase-admin/app");
  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return cachedApp;
  }

  const config = getFirebaseAdminConfig();
  if (!config) return null;

  cachedApp = initializeApp({
    credential: cert({
      projectId: config.projectId,
      clientEmail: config.clientEmail,
      privateKey: config.privateKey,
    }),
    projectId: config.projectId,
  });

  return cachedApp;
}

export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (cachedMessaging) return cachedMessaging;
  const app = await getFirebaseAdminApp();
  if (!app) return null;
  const { getMessaging } = await import("firebase-admin/messaging");
  cachedMessaging = getMessaging(app);
  return cachedMessaging;
}
