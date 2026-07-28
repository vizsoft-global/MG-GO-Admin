"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { makeQueryClient } from "@/lib/query/make-query-client";
import { QueryDevtoolsWrapper } from "@/components/providers/query-devtools";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      {children}
      <QueryDevtoolsWrapper />
    </QueryClientProvider>
  );
}
