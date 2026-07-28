"use client";

import { useTransition } from "react";
import { signOut } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";

export function PendingSignOutButton({
  label,
  locale,
}: {
  label: string;
  locale: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      className="cursor-pointer rounded-lg"
      disabled={isPending}
      onClick={() => startTransition(() => signOut(locale))}
    >
      {label}
    </Button>
  );
}
