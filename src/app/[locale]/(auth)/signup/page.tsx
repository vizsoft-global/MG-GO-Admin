import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { SignUpForm } from "@/features/auth/signup-form";
import { Skeleton } from "@/components/ui/skeleton";

export default async function SignUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense fallback={<Skeleton className="h-[480px] w-full max-w-md rounded-xl" />}>
      <SignUpForm />
    </Suspense>
  );
}
