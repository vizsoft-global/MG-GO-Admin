import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSessionOutcome } from "@/lib/auth/get-session";
import { signedInEntryRedirect } from "@/lib/auth/staff-entry";
import { LoginForm } from "@/features/auth/login-form";
import { Skeleton } from "@/components/ui/skeleton";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { session, unavailable } = await getSessionOutcome();
  if (!unavailable) {
    const next = signedInEntryRedirect(session?.profile ?? null);
    if (next) redirect({ href: next, locale });
  }

  return (
    <Suspense
      fallback={<Skeleton className="h-[420px] w-full max-w-md rounded-xl" />}
    >
      <LoginForm />
    </Suspense>
  );
}
