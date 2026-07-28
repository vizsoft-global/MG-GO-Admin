import * as pulumi from "@pulumi/pulumi";
import * as config from "../config";

/** Testing stack — documents existing infrastructure (no resources created). */
export function deployTesting() {
  pulumi.log.info(
    "Testing stack: referencing existing projects (no resources will be created).",
  );

  return {
    environment: config.environment,
    supabaseProjectRef: config.testingSupabaseProjectRef,
    supabaseUrl: config.testingSupabaseProjectRef
      ? pulumi.interpolate`https://${config.testingSupabaseProjectRef}.supabase.co`
      : undefined,
    firebaseProjectId: config.testingFirebaseProjectId,
    r2BucketName: config.testingR2BucketName,
    vercelProjectId: config.testingVercelProjectId,
    appUrl: config.testingAppUrl,
  };
}
