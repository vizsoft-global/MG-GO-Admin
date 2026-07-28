export type FirebaseClientPlatform = "android" | "ios" | "web";

export type FirebaseClientConfig = {
  projectId: string;
  appId: string;
  apiKey: string;
  messagingSenderId: string;
  storageBucket?: string;
  authDomain?: string;
};

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function getFirebaseClientConfig(
  platform: FirebaseClientPlatform,
): FirebaseClientConfig | null {
  const projectId = readEnv("FIREBASE_PROJECT_ID") ?? readEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  const apiKey = readEnv("NEXT_PUBLIC_FIREBASE_API_KEY");
  const messagingSenderId =
    readEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID") ??
    readEnv("FIREBASE_MESSAGING_SENDER_ID");
  const storageBucket = readEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
  const authDomain = readEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");

  const appIdByPlatform: Record<FirebaseClientPlatform, string | undefined> = {
    android: readEnv("FIREBASE_APP_ID_ANDROID"),
    ios: readEnv("FIREBASE_APP_ID_IOS"),
    web: readEnv("FIREBASE_APP_ID_WEB") ?? readEnv("NEXT_PUBLIC_FIREBASE_APP_ID"),
  };

  const appId = appIdByPlatform[platform];
  if (!projectId || !apiKey || !messagingSenderId || !appId) return null;

  return {
    projectId,
    appId,
    apiKey,
    messagingSenderId,
    storageBucket,
    authDomain,
  };
}

export function isFirebaseClientConfigured(platform?: FirebaseClientPlatform): boolean {
  if (platform) return getFirebaseClientConfig(platform) !== null;
  return (
    getFirebaseClientConfig("android") !== null ||
    getFirebaseClientConfig("ios") !== null ||
    getFirebaseClientConfig("web") !== null
  );
}
