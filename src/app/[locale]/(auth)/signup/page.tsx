import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSessionOutcome } from "@/lib/auth/get-session";
import { signedInEntryRedirect } from "@/lib/auth/staff-entry";
import { SignUpForm } from "@/features/auth/signup-form";
import { Skeleton } from "@/components/ui/skeleton";

export default async function SignUpPage({
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
    <Suspense fallback={<Skeleton className="h-[480px] w-full max-w-md rounded-xl" />}>
      <SignUpForm />
    </Suspense>
  );
}
