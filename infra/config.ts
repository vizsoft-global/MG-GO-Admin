import * as pulumi from "@pulumi/pulumi";

const cfg = new pulumi.Config("dpd-infra");

export const stackName = pulumi.getStack();
export const environment = cfg.require("environment");

export const isProduction = environment === "production";
export const isTesting = environment === "testing";

// Testing — existing resource references
export const testingSupabaseProjectRef = cfg.get("supabaseProjectRef");
export const testingFirebaseProjectId = cfg.get("firebaseProjectId");
export const testingR2BucketName = cfg.get("r2BucketName");
export const testingVercelProjectId = cfg.get("vercelProjectId");
export const testingAppUrl = cfg.get("appUrl");

// Production — creation parameters
export const supabaseProjectName = cfg.get("supabaseProjectName") ?? "dpd-production";
export const supabaseOrganizationId = cfg.require("supabaseOrganizationId");
export const supabaseRegion = cfg.get("supabaseRegion") ?? "ap-south-1";
export const supabaseInstanceSize = cfg.get("supabaseInstanceSize") ?? "micro";
export const supabaseAccessToken = cfg.getSecret("supabaseAccessToken");
export const supabaseDatabasePassword = cfg.getSecret("supabaseDatabasePassword");

export const gcpProjectId = cfg.get("gcpProjectId") ?? "musallam-delivery-prod";
export const gcpProjectName = cfg.get("gcpProjectName") ?? "Musallam Delivery Production";
export const gcpBillingAccount = cfg.get("gcpBillingAccount");
export const gcpOrgId = cfg.get("gcpOrgId");
export const gcpCredentials = cfg.getSecret("gcpCredentials");
export const firebaseAndroidPackage = cfg.get("firebaseAndroidPackage") ?? "kw.musallam.delivery";
export const firebaseIosBundleId = cfg.get("firebaseIosBundleId") ?? "kw.musallam.delivery";
export const firebaseServiceAccountJson = cfg.getSecret("firebaseServiceAccountJson");

export const cloudflareAccountId = cfg.require("cloudflareAccountId");
export const cloudflareApiToken = cfg.getSecret("cloudflareApiToken");
export const r2BucketName = cfg.get("r2BucketName") ?? "dpd-private-prod";

export const vercelApiToken = cfg.getSecret("vercelApiToken");
export const vercelTeamId = cfg.get("vercelTeamId");
export const vercelProjectName = cfg.get("vercelProjectName") ?? "dpdadmin-prod";
export const vercelGitRepo = cfg.get("vercelGitRepo") ?? "dpdadmin";
export const vercelGitOrg = cfg.get("vercelGitOrg") ?? "Vizsoft";
export const vercelFramework = cfg.get("vercelFramework") ?? "nextjs";
export const vercelRootDirectory = cfg.get("vercelRootDirectory") ?? "";

export const googleMapsApiKey = cfg.getSecret("googleMapsApiKey");
export const maptilerApiKey = cfg.getSecret("maptilerApiKey");

/** Supabase API keys — set after project creation via fetch-supabase-api-keys script */
export const supabaseAnonKey = cfg.getSecret("supabaseAnonKey");
export const supabasePublishableKey = cfg.getSecret("supabasePublishableKey");
export const supabaseServiceRoleKey = cfg.getSecret("supabaseServiceRoleKey");

export const r2AccessKeyId = cfg.getSecret("r2AccessKeyId");
export const r2SecretAccessKey = cfg.getSecret("r2SecretAccessKey");

export function secretOrPlaceholder(
  secret: pulumi.Output<string> | undefined,
  placeholder: string,
): pulumi.Output<string> {
  if (secret) return secret;
  return pulumi.output(placeholder);
}
