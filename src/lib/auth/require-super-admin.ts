import { redirect } from "@/i18n/navigation";
import { requireAuth } from "./require-permission";

export async function requireSuperAdmin(locale: string) {
  const session = await requireAuth(locale);
  if (!session.isSuperAdmin) {
    redirect({ href: "/unauthorized", locale });
  }
  return session;
}
