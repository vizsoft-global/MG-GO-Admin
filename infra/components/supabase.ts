import * as pulumi from "@pulumi/pulumi";
import * as supabase from "@pulumi/supabase";
import * as config from "../config";

export type SupabaseStackResult = {
  project: supabase.Project;
  projectRef: pulumi.Output<string>;
  supabaseUrl: pulumi.Output<string>;
  /** Set via pulumi config after running scripts/fetch-supabase-api-keys.mjs */
  anonKey: pulumi.Output<string>;
  publishableKey: pulumi.Output<string>;
  serviceRoleKey: pulumi.Output<string>;
};

export function createProductionSupabase(): SupabaseStackResult {
  const dbPassword = config.supabaseDatabasePassword;
  if (!dbPassword) {
    throw new Error(
      "Set secret: pulumi config set --secret dpd-infra:supabaseDatabasePassword <password>",
    );
  }

  const project = new supabase.Project("dpd-supabase-prod", {
    name: config.supabaseProjectName,
    organizationId: config.supabaseOrganizationId,
    databasePassword: dbPassword,
    region: config.supabaseRegion,
    instanceSize: config.supabaseInstanceSize,
    // Legacy JWT keys required by dpdadmin until fully on publishable keys
    legacyApiKeysEnabled: true,
  });

  const projectRef = project.id;
  const supabaseUrl = pulumi.interpolate`https://${projectRef}.supabase.co`;

  // Schema: run scripts/replicate-supabase.sh after project is ACTIVE.
  const apiKeys = supabase.getApikeysOutput(
    { projectRef },
    { dependsOn: [project] },
  );

  const anonKey = config.supabaseAnonKey
    ? pulumi.secret(config.supabaseAnonKey)
    : apiKeys.apply((k) => k.anonKey);
  const publishableKey = config.supabasePublishableKey
    ? pulumi.secret(config.supabasePublishableKey)
    : apiKeys.apply((k) => k.publishableKey);
  const serviceRoleKey = config.supabaseServiceRoleKey
    ? pulumi.secret(config.supabaseServiceRoleKey)
    : apiKeys.apply((k) => k.serviceRoleKey);

  return {
    project,
    projectRef,
    supabaseUrl,
    anonKey,
    publishableKey,
    serviceRoleKey,
  };
}
