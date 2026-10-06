import { setRequestLocale } from "next-intl/server";
import { EsignSendShell } from "@/features/esign/esign-send-shell";
import { requireAnyPermission } from "@/lib/auth/require-permission";

/**
 * EmployeeDesk V2's send screen.
 *
 * It renders the **same** `EsignSendShell` the V1 route at
 * `/requests/esign/send` renders, and that is deliberate rather than a
 * shortcut: sending a document is one workflow, and a second copy of it would
 * be a second place for the resolve rules, the due-date guard and the
 * screenshot policy to drift. What the V2 route adds is a home under
 * EmployeeDesk and the `?template=` hand-off from the builder.
 *
 * `initialTemplateId` is read here, on the server, from the query string. The
 * shell cannot read it itself without a `useSearchParams` hook and the Suspense
 * boundary that hook needs, and the page already has the value in hand.
 */
export default async function EmployeeDeskEsignSendPage({
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
  const category = query.category;
  const driver = query.driver;
  const resentFrom = query.resentFrom;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);
  return (
    <EsignSendShell
      initialTemplateId={typeof template === "string" ? template : undefined}
      initialDraftId={typeof draft === "string" ? draft : undefined}
      initialCategoryKey={typeof category === "string" ? category : undefined}
      initialDriverId={typeof driver === "string" ? driver : undefined}
      initialResentFromId={typeof resentFrom === "string" ? resentFrom : undefined}
    />
  );
}
