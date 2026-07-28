import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { LoginForm } from "@/features/auth/login-form";
import { Skeleton } from "@/components/ui/skeleton";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense
      fallback={<Skeleton className="h-[420px] w-full max-w-md rounded-xl" />}
    >
      <LoginForm />
    </Suspense>
  );
}
