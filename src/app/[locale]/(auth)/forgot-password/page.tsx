import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";
import { Skeleton } from "@/components/ui/skeleton";

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense fallback={<Skeleton className="h-[360px] w-full max-w-md rounded-xl" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
