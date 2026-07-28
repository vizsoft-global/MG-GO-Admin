import * as pulumi from "@pulumi/pulumi";
import * as vercel from "@pulumiverse/vercel";
import * as config from "../config";
import { buildProductionEnvVars, type EnvVarInput } from "./env-contract";

export type VercelStackResult = {
  project: vercel.Project;
  projectId: pulumi.Output<string>;
  envVars: vercel.ProjectEnvironmentVariable[];
};

function wireEnvVar(
  name: string,
  projectId: pulumi.Input<string>,
  env: EnvVarInput,
  index: number,
): vercel.ProjectEnvironmentVariable {
  const resourceName = `env-${env.key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`;
  return new vercel.ProjectEnvironmentVariable(resourceName, {
    projectId,
    key: env.key,
    value: env.value,
    sensitive: env.sensitive ?? false,
    targets: ["production", "preview", "development"],
    teamId: config.vercelTeamId,
  });
}

export function createProductionVercel(args: {
  supabaseUrl: pulumi.Input<string>;
  supabaseAnonKey: pulumi.Input<string>;
  supabasePublishableKey: pulumi.Input<string>;
  supabaseServiceRoleKey: pulumi.Input<string>;
  r2BucketName: pulumi.Input<string>;
  r2AccessKeyId: pulumi.Input<string>;
  r2SecretAccessKey: pulumi.Input<string>;
  r2Endpoint: pulumi.Input<string>;
  cloudflareApiToken: pulumi.Input<string>;
  firebase: {
    projectId: pulumi.Input<string>;
    authDomain: pulumi.Input<string>;
    storageBucket: pulumi.Input<string>;
    messagingSenderId: pulumi.Input<string>;
    webApiKey: pulumi.Input<string>;
    webAppId: pulumi.Input<string>;
    androidAppId: pulumi.Input<string>;
    iosAppId: pulumi.Input<string>;
    serviceAccountEmail: pulumi.Input<string>;
    serviceAccountPrivateKey: pulumi.Input<string>;
    serviceAccountJson: pulumi.Input<string>;
  };
  cronSecret: pulumi.Input<string>;
}): VercelStackResult {
  if (!config.vercelApiToken) {
    throw new Error("Set secret: pulumi config set --secret dpd-infra:vercelApiToken <token>");
  }

  const project = new vercel.Project("dpdadmin-prod", {
    name: config.vercelProjectName,
    framework: config.vercelFramework,
    rootDirectory: config.vercelRootDirectory || undefined,
    teamId: config.vercelTeamId,
    gitRepository: {
      type: "github",
      repo: `${config.vercelGitOrg}/${config.vercelGitRepo}`,
    },
    buildCommand: "npm run build",
    installCommand: "npm install",
    devCommand: "npm run dev",
  });

  const projectId = project.id;
  const appUrl = pulumi.interpolate`https://${config.vercelProjectName}.vercel.app`;

  const envDefinitions = buildProductionEnvVars({
    supabaseUrl: args.supabaseUrl,
    supabaseAnonKey: args.supabaseAnonKey,
    supabasePublishableKey: args.supabasePublishableKey,
    supabaseServiceRoleKey: args.supabaseServiceRoleKey,
    appUrl,
    r2AccountId: config.cloudflareAccountId,
    r2BucketName: args.r2BucketName,
    r2AccessKeyId: args.r2AccessKeyId,
    r2SecretAccessKey: args.r2SecretAccessKey,
    r2Endpoint: args.r2Endpoint,
    cloudflareApiToken: args.cloudflareApiToken,
    firebaseProjectId: args.firebase.projectId,
    firebaseClientEmail: args.firebase.serviceAccountEmail,
    firebasePrivateKey: args.firebase.serviceAccountPrivateKey,
    firebaseServiceAccountJson: args.firebase.serviceAccountJson,
    firebaseApiKey: args.firebase.webApiKey,
    firebaseMessagingSenderId: args.firebase.messagingSenderId,
    firebaseStorageBucket: args.firebase.storageBucket,
    firebaseAuthDomain: args.firebase.authDomain,
    firebaseAppIdWeb: args.firebase.webAppId,
    firebaseAppIdAndroid: args.firebase.androidAppId,
    firebaseAppIdIos: args.firebase.iosAppId,
    cronSecret: args.cronSecret,
    googleMapsApiKey: config.googleMapsApiKey,
    maptilerApiKey: config.maptilerApiKey,
  });

  const envVars = envDefinitions.map((env, i) =>
    wireEnvVar(`dpdadmin-prod`, projectId, env, i),
  );

  return { project, projectId, envVars };
}
