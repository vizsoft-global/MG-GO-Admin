import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EsignWaitingShell } from "@/features/esign/esign-waiting-shell";

/**
 * Waiting — reference panel F6.
 *
 * `requests.manage`, matching every other E-Sign screen and, more to the point,
 * matching the two server actions the shell reads through: `fetchEsignRequestsList`
 * and `fetchEsignStatusCounts` both refuse a caller without it. The reference
 * splits reads (`requests.view`) from writes (`requests.manage`), and the
 * reminder half of this screen already honours that split in the database
 * (`admin_esign_reminder_state` reads on `requests.view`, the send requires
 * `requests.manage`) — but a page gated on the read permission would open for an
 * operator whose list fetch is refused, which is a screen that renders an error
 * rather than a screen that is read-only. Widening the read is a module-wide
 * change to every E-Sign action and page at once, not a decision one route can
 * take on its own.
 */
export default async function EsignWaitingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");
  return <EsignWaitingShell />;
}
