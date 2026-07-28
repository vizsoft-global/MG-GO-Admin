import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import * as config from "../config";
import { createProductionSupabase } from "./supabase";
import { createProductionR2 } from "./cloudflare";
import { createProductionFirebase } from "./firebase";
import { createProductionVercel } from "./vercel";

export function deployProduction() {
  pulumi.log.info("Production stack: creating clean infrastructure (schema via CLI script).");

  const supabase = createProductionSupabase();
  const r2 = createProductionR2();
  const firebase = createProductionFirebase();

  const cronSecret = new random.RandomPassword("cron-secret", {
    length: 32,
    special: false,
  });

  const cloudflareToken =
    config.cloudflareApiToken ??
    pulumi.output("REPLACE_CLOUDFLARE_API_TOKEN");

  const vercel = createProductionVercel({
    supabaseUrl: supabase.supabaseUrl,
    supabaseAnonKey: supabase.anonKey,
    supabasePublishableKey: supabase.publishableKey,
    supabaseServiceRoleKey: supabase.serviceRoleKey,
    r2BucketName: r2.bucketName,
    r2AccessKeyId: r2.accessKeyId,
    r2SecretAccessKey: r2.secretAccessKey,
    r2Endpoint: r2.r2Endpoint,
    cloudflareApiToken: cloudflareToken,
    firebase: {
      projectId: firebase.projectId,
      authDomain: firebase.authDomain,
      storageBucket: firebase.storageBucket,
      messagingSenderId: firebase.messagingSenderId,
      webApiKey: firebase.webApiKey,
      webAppId: firebase.webAppId,
      androidAppId: firebase.androidAppId,
      iosAppId: firebase.iosAppId,
      serviceAccountEmail: firebase.serviceAccountEmail,
      serviceAccountPrivateKey: firebase.serviceAccountPrivateKey,
      serviceAccountJson: firebase.serviceAccountJson,
    },
    cronSecret: cronSecret.result,
  });

  return {
    environment: config.environment,
    supabaseProjectRef: supabase.projectRef,
    supabaseUrl: supabase.supabaseUrl,
    r2BucketName: r2.bucketName,
    r2Endpoint: r2.r2Endpoint,
    firebaseProjectId: firebase.projectId,
    firebaseAndroidAppId: firebase.androidAppId,
    firebaseIosAppId: firebase.iosAppId,
    firebaseWebAppId: firebase.webAppId,
    vercelProjectId: vercel.projectId,
    vercelProjectName: config.vercelProjectName,
    nextSteps: pulumi.output([
      "1. Wait for Supabase project to become ACTIVE in dashboard",
      "2. cd dpdadmin/infra && bash scripts/replicate-supabase.sh <project_ref>",
      "3. node scripts/fetch-supabase-api-keys.mjs <project_ref>",
      "4. pulumi config set --secret dpd-infra:supabaseAnonKey ... (and publishable + service_role)",
      "5. Create R2 S3 API token in Cloudflare dashboard; set r2AccessKeyId + r2SecretAccessKey secrets",
      "6. pulumi up (refresh Vercel env vars)",
      "7. vercel deploy --prod from dpdadmin/",
    ]),
  };
}
