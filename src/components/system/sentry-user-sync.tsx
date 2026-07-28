"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";

export function SentryUserSync() {
  const { userId } = useAuth();

  useEffect(() => {
    Sentry.setUser({ id: userId });
    return () => {
      Sentry.setUser(null);
    };
  }, [userId]);

  return null;
}
