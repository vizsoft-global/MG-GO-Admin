import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";
import { Skeleton } from "@/components/ui/skeleton";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense fallback={<Skeleton className="h-[360px] w-full max-w-md rounded-xl" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
