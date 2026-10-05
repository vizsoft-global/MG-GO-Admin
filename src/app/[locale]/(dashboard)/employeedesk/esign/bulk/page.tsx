import { setRequestLocale } from "next-intl/server";
import { BulkImportShell } from "@/features/employeedesk/esign/bulk-import-shell";
import { requireAnyPermission } from "@/lib/auth/require-permission";

/**
 * EmployeeDesk V2's bulk-import screen — the reference's three steps.
 *
 * Distinct from `/requests/esign/bulk` (V1) on purpose. V1 is a single long form
 * that picks a template, uploads and sends, and it stays exactly as it is;
 * what it cannot do is tell an operator *which columns the sheet may contain*
 * before they upload, which is what the reference's step 3 states by splitting
 * the template's own fields into "filled from the system" and "you add in the
 * sheet". Both screens call the same `createEsignBatch` /
 * `processEsignBatchChunk`, so a batch created from either door is the same
 * object in the same queue — there is no second definition of "sendable".
 *
 * `?template=` is the builder's hand-off and preselects step 1. `?draft=` is the
 * drafts list's hand-off and resumes a saved sheet straight into step 3.
 */
export default async function EmployeeDeskEsignBulkPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const template = query.template;
  const draft = query.draft;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);
  return (
    <BulkImportShell
      initialTemplateId={typeof template === "string" ? template : undefined}
      initialDraftId={typeof draft === "string" ? draft : undefined}
    />
  );
}
