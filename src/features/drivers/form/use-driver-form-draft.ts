"use client";

import { useEffect, useRef, useState } from "react";

type DraftPayload = Record<string, unknown>;

const SAVE_DELAY_MS = 500;

export function useDriverFormDraft({
  enabled,
  key,
  payload,
}: {
  enabled: boolean;
  key: string;
  payload: DraftPayload;
}) {
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      hydratedRef.current = false;
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      localStorage.setItem(key, JSON.stringify(payload));
      setSavedAt(new Date());
    }, SAVE_DELAY_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [enabled, key, payload]);

  useEffect(() => {
    if (!enabled || hydratedRef.current) return;
    hydratedRef.current = true;
  }, [enabled]);

  const clearDraft = () => {
    localStorage.removeItem(key);
    setSavedAt(null);
  };

  return { savedAt, clearDraft };
}

