import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RiderComplianceUploadShell } from "@/features/compliance/rider-compliance-upload-shell";

export default async function CompliancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "compliance.view");

  return <RiderComplianceUploadShell />;
}
