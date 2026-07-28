"use client";

import dynamic from "next/dynamic";

const ReactQueryDevtools = dynamic(
  () =>
    import("@tanstack/react-query-devtools").then((mod) => mod.ReactQueryDevtools),
  { ssr: false },
);

export function QueryDevtoolsWrapper() {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }
  return <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />;
}
