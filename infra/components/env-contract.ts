import * as pulumi from "@pulumi/pulumi";

/** Env vars required by dpdadmin/.env.example — wired to Vercel on production. */
export type EnvVarInput = {
  key: string;
  value: pulumi.Input<string>;
  sensitive?: boolean;
};

export function buildProductionEnvVars(args: {
  supabaseUrl: pulumi.Input<string>;
  supabaseAnonKey: pulumi.Input<string>;
  supabasePublishableKey: pulumi.Input<string>;
  supabaseServiceRoleKey: pulumi.Input<string>;
  appUrl: pulumi.Input<string>;
  r2AccountId: string;
  r2BucketName: pulumi.Input<string>;
  r2AccessKeyId: pulumi.Input<string>;
  r2SecretAccessKey: pulumi.Input<string>;
  r2Endpoint: pulumi.Input<string>;
  cloudflareApiToken: pulumi.Input<string>;
  firebaseProjectId: pulumi.Input<string>;
  firebaseClientEmail: pulumi.Input<string>;
  firebasePrivateKey: pulumi.Input<string>;
  firebaseServiceAccountJson: pulumi.Input<string>;
  firebaseApiKey: pulumi.Input<string>;
  firebaseMessagingSenderId: pulumi.Input<string>;
  firebaseStorageBucket: pulumi.Input<string>;
  firebaseAuthDomain: pulumi.Input<string>;
  firebaseAppIdWeb: pulumi.Input<string>;
  firebaseAppIdAndroid: pulumi.Input<string>;
  firebaseAppIdIos: pulumi.Input<string>;
  cronSecret: pulumi.Input<string>;
  googleMapsApiKey?: pulumi.Input<string>;
  maptilerApiKey?: pulumi.Input<string>;
}): EnvVarInput[] {
  const vars: EnvVarInput[] = [
    { key: "NEXT_PUBLIC_SUPABASE_URL", value: args.supabaseUrl },
    { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: args.supabaseAnonKey, sensitive: true },
    { key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", value: args.supabasePublishableKey, sensitive: true },
    { key: "SUPABASE_SERVICE_ROLE_KEY", value: args.supabaseServiceRoleKey, sensitive: true },
    { key: "NEXT_PUBLIC_APP_URL", value: args.appUrl },
    { key: "R2_ACCOUNT_ID", value: args.r2AccountId },
    { key: "R2_BUCKET_NAME", value: args.r2BucketName },
    { key: "R2_ACCESS_KEY_ID", value: args.r2AccessKeyId, sensitive: true },
    { key: "R2_SECRET_ACCESS_KEY", value: args.r2SecretAccessKey, sensitive: true },
    { key: "R2_S3_ENDPOINT", value: args.r2Endpoint },
    { key: "CLOUDFLARE_API_TOKEN", value: args.cloudflareApiToken, sensitive: true },
    { key: "CRON_SECRET", value: args.cronSecret, sensitive: true },
    { key: "DRIVER_APP_ORIGINS", value: "https://dpdadmin-prod.vercel.app" },
    { key: "FIREBASE_PROJECT_ID", value: args.firebaseProjectId },
    { key: "FIREBASE_CLIENT_EMAIL", value: args.firebaseClientEmail, sensitive: true },
    { key: "FIREBASE_PRIVATE_KEY", value: args.firebasePrivateKey, sensitive: true },
    { key: "FIREBASE_SERVICE_ACCOUNT_JSON", value: args.firebaseServiceAccountJson, sensitive: true },
    { key: "NEXT_PUBLIC_FIREBASE_API_KEY", value: args.firebaseApiKey },
    { key: "NEXT_PUBLIC_FIREBASE_PROJECT_ID", value: args.firebaseProjectId },
    { key: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", value: args.firebaseMessagingSenderId },
    { key: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", value: args.firebaseStorageBucket },
    { key: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", value: args.firebaseAuthDomain },
    { key: "NEXT_PUBLIC_FIREBASE_APP_ID", value: args.firebaseAppIdWeb },
    { key: "FIREBASE_APP_ID_ANDROID", value: args.firebaseAppIdAndroid },
    { key: "FIREBASE_APP_ID_IOS", value: args.firebaseAppIdIos },
    { key: "FIREBASE_APP_ID_WEB", value: args.firebaseAppIdWeb },
    { key: "FIREBASE_ANALYTICS_ENABLED", value: "true" },
    { key: "FIREBASE_CRASHLYTICS_ENABLED", value: "true" },
    { key: "FIREBASE_PERFORMANCE_ENABLED", value: "true" },
    { key: "FIREBASE_REMOTE_CONFIG_ENABLED", value: "true" },
    { key: "NOTIFICATION_APPROVAL_REQUIRED_CATEGORIES", value: "high,broadcast,emergency" },
    { key: "NOTIFICATION_SEND_RATE_PER_MINUTE", value: "600" },
    { key: "NOTIFICATION_BATCH_SIZE", value: "500" },
    { key: "NEXT_PUBLIC_MAPTILER_MAP_ID", value: "streets-v2" },
  ];

  if (args.googleMapsApiKey) {
    vars.push({ key: "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", value: args.googleMapsApiKey, sensitive: true });
  }
  if (args.maptilerApiKey) {
    vars.push({ key: "NEXT_PUBLIC_MAPTILER_API_KEY", value: args.maptilerApiKey, sensitive: true });
  }

  return vars;
}
