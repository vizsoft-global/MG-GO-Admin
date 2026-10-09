import { getFirebaseAdminConfig } from "./config";

type FirebaseApp = import("firebase-admin/app").App;
type Messaging = import("firebase-admin/messaging").Messaging;
type Auth = import("firebase-admin/auth").Auth;
type Firestore = import("firebase-admin/firestore").Firestore;
type Storage = import("firebase-admin/storage").Storage;

let cachedApp: FirebaseApp | null = null;
let cachedMessaging: Messaging | null = null;
let cachedAuth: Auth | null = null;
let cachedFirestore: Firestore | null = null;
let cachedStorage: Storage | null = null;

/**
 * The single Firebase Admin app for musallam-delivery-prod.
 *
 * One app carries FCM, Auth, Firestore and Storage, because they are one
 * project: pointing any of them at a different project is how FCM starts
 * returning a sender mismatch. The service account is the same one the
 * notification sender already uses; Firestore and Auth access ride that same
 * account, so no second credential exists to drift.
 */
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
    ...(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
      ? { storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET }
      : {}),
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

export async function getFirebaseAuth(): Promise<Auth | null> {
  if (cachedAuth) return cachedAuth;
  const app = await getFirebaseAdminApp();
  if (!app) return null;
  const { getAuth } = await import("firebase-admin/auth");
  cachedAuth = getAuth(app);
  return cachedAuth;
}

export async function getFirebaseFirestore(): Promise<Firestore | null> {
  if (cachedFirestore) return cachedFirestore;
  const app = await getFirebaseAdminApp();
  if (!app) return null;
  const { getFirestore } = await import("firebase-admin/firestore");
  cachedFirestore = getFirestore(app);
  return cachedFirestore;
}

export async function getFirebaseStorage(): Promise<Storage | null> {
  if (cachedStorage) return cachedStorage;
  const app = await getFirebaseAdminApp();
  if (!app) return null;
  const { getStorage } = await import("firebase-admin/storage");
  cachedStorage = getStorage(app);
  return cachedStorage;
}

/** Test seam — drops every cached handle so a config change is picked up. */
export function resetFirebaseAdminCaches(): void {
  cachedApp = null;
  cachedMessaging = null;
  cachedAuth = null;
  cachedFirestore = null;
  cachedStorage = null;
}
