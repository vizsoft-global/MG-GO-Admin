import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as config from "../config";

export type FirebaseStackResult = {
  gcpProject: gcp.organizations.Project;
  firebaseProject: gcp.firebase.Project;
  androidApp: gcp.firebase.AndroidApp;
  iosApp: gcp.firebase.AppleApp;
  webApp: gcp.firebase.WebApp;
  projectId: pulumi.Output<string>;
  authDomain: pulumi.Output<string>;
  storageBucket: pulumi.Output<string>;
  messagingSenderId: pulumi.Output<string>;
  webApiKey: pulumi.Output<string>;
  webAppId: pulumi.Output<string>;
  androidAppId: pulumi.Output<string>;
  iosAppId: pulumi.Output<string>;
  serviceAccountEmail: pulumi.Output<string>;
  serviceAccountPrivateKey: pulumi.Output<string>;
  serviceAccountJson: pulumi.Output<string>;
};

export function createProductionFirebase(): FirebaseStackResult {
  if (!config.gcpBillingAccount || !config.gcpOrgId) {
    throw new Error(
      "Set dpd-infra:gcpBillingAccount and dpd-infra:gcpOrgId before deploying production Firebase/GCP.",
    );
  }

  const gcpProject = new gcp.organizations.Project("dpd-gcp-prod", {
    projectId: config.gcpProjectId,
    name: config.gcpProjectName,
    orgId: config.gcpOrgId,
    billingAccount: config.gcpBillingAccount,
    labels: {
      environment: "production",
      app: "dpd",
    },
  });

  const firebaseProject = new gcp.firebase.Project(
    "dpd-firebase-prod",
    { project: gcpProject.projectId },
    { dependsOn: [gcpProject] },
  );

  const androidApp = new gcp.firebase.AndroidApp(
    "dpd-firebase-android",
    {
      project: gcpProject.projectId,
      displayName: "DPD Driver Android (Production)",
      packageName: config.firebaseAndroidPackage,
    },
    { dependsOn: [firebaseProject] },
  );

  const iosApp = new gcp.firebase.AppleApp(
    "dpd-firebase-ios",
    {
      project: gcpProject.projectId,
      displayName: "DPD Driver iOS (Production)",
      bundleId: config.firebaseIosBundleId,
    },
    { dependsOn: [firebaseProject] },
  );

  const webApp = new gcp.firebase.WebApp(
    "dpd-firebase-web",
    {
      project: gcpProject.projectId,
      displayName: "DPD Admin Web (Production)",
    },
    { dependsOn: [firebaseProject] },
  );

  const projectId = gcpProject.projectId;
  const authDomain = pulumi.interpolate`${projectId}.firebaseapp.com`;
  const storageBucket = pulumi.interpolate`${projectId}.firebasestorage.app`;
  const messagingSenderId = gcpProject.number;

  const webAppConfig = gcp.firebase.getWebAppConfigOutput({
    webAppId: webApp.appId,
    project: projectId,
  });

  const webApiKey = webAppConfig.apiKey;
  const webAppId = webApp.appId;
  const androidAppId = androidApp.appId;
  const iosAppId = iosApp.appId;

  const sa = new gcp.serviceaccount.Account("dpd-firebase-admin-sa", {
    accountId: "dpd-admin-firebase",
    displayName: "DPD Admin Firebase Admin",
    project: projectId,
  });

  new gcp.projects.IAMMember("dpd-firebase-admin-sdk", {
    project: projectId,
    role: "roles/firebase.admin",
    member: pulumi.interpolate`serviceAccount:${sa.email}`,
  });

  const saKey = new gcp.serviceaccount.Key("dpd-firebase-admin-key", {
    serviceAccountId: sa.name,
  });

  const serviceAccountEmail = sa.email;
  const serviceAccountPrivateKey = saKey.privateKey.apply((b64) => {
    const json = Buffer.from(b64, "base64").toString("utf8");
    const parsed = JSON.parse(json) as { private_key: string };
    return parsed.private_key;
  });

  const serviceAccountJson = saKey.privateKey.apply((b64) =>
    Buffer.from(b64, "base64").toString("utf8"),
  );

  const jsonFromConfig = config.firebaseServiceAccountJson;
  const finalServiceAccountJson = jsonFromConfig ?? serviceAccountJson;

  return {
    gcpProject,
    firebaseProject,
    androidApp,
    iosApp,
    webApp,
    projectId,
    authDomain,
    storageBucket,
    messagingSenderId,
    webApiKey,
    webAppId,
    androidAppId,
    iosAppId,
    serviceAccountEmail,
    serviceAccountPrivateKey,
    serviceAccountJson: finalServiceAccountJson,
  };
}
