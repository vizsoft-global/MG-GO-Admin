import * as supabase from "@pulumi/supabase";
import * as cloudflare from "@pulumi/cloudflare";
import * as vercel from "@pulumiverse/vercel";
import * as gcp from "@pulumi/gcp";
import * as config from "./config";

/** Configure cloud providers from Pulumi secrets / environment. */
export function configureProviders(): void {
  if (config.supabaseAccessToken) {
    new supabase.Provider("supabase", {
      accessToken: config.supabaseAccessToken,
    });
  }

  if (config.cloudflareApiToken) {
    new cloudflare.Provider("cloudflare", {
      apiToken: config.cloudflareApiToken,
    });
  }

  if (config.vercelApiToken) {
    new vercel.Provider("vercel", {
      apiToken: config.vercelApiToken,
    });
  }

  if (config.gcpCredentials) {
    new gcp.Provider("gcp", {
      credentials: config.gcpCredentials,
      project: config.gcpProjectId,
    });
  }
}
