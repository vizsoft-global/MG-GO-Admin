import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as config from "../config";

export type CloudflareStackResult = {
  bucket: cloudflare.R2Bucket;
  bucketName: pulumi.Output<string>;
  r2Endpoint: pulumi.Output<string>;
  /** S3-compatible credentials — create token in dashboard or set in config */
  accessKeyId: pulumi.Output<string>;
  secretAccessKey: pulumi.Output<string>;
};

export function createProductionR2(): CloudflareStackResult {
  const bucket = new cloudflare.R2Bucket("dpd-r2-prod", {
    accountId: config.cloudflareAccountId,
    name: config.r2BucketName,
    location: "WEUR",
  });

  const r2Endpoint = pulumi.output(
    `https://${config.cloudflareAccountId}.r2.cloudflarestorage.com`,
  );

  const accessKeyId = config.secretOrPlaceholder(
    config.r2AccessKeyId,
    "REPLACE_R2_ACCESS_KEY_ID",
  );
  const secretAccessKey = config.secretOrPlaceholder(
    config.r2SecretAccessKey,
    "REPLACE_R2_SECRET_ACCESS_KEY",
  );

  return {
    bucket,
    bucketName: bucket.name,
    r2Endpoint,
    accessKeyId,
    secretAccessKey,
  };
}
