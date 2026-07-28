import * as config from "./config";
import { configureProviders } from "./providers";
import { deployTesting } from "./components/testing";
import { deployProduction } from "./components/production";

if (config.isProduction) {
  configureProviders();
}

const result = config.isProduction ? deployProduction() : deployTesting();

export const environment = result.environment;
export const supabaseProjectRef =
  "supabaseProjectRef" in result ? result.supabaseProjectRef : undefined;
export const supabaseUrl = "supabaseUrl" in result ? result.supabaseUrl : undefined;
export const firebaseProjectId =
  "firebaseProjectId" in result ? result.firebaseProjectId : undefined;
export const r2BucketName = "r2BucketName" in result ? result.r2BucketName : undefined;
export const vercelProjectId =
  "vercelProjectId" in result ? result.vercelProjectId : undefined;
export const appUrl = "appUrl" in result ? result.appUrl : undefined;
// nextSteps only exists on production stack
