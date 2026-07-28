"use client";

import { useEffect, useState } from "react";

export function NotificationMediaPreview({
  objectKey,
  alt,
  className = "h-40 w-full rounded-lg object-cover",
}: {
  objectKey: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/storage/signed-url?key=${encodeURIComponent(objectKey)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        const json = (await res.json()) as { url?: string };
        return json.url ?? null;
      })
      .then((nextUrl) => {
        if (!cancelled) setUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [objectKey]);

  if (!url) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} className={className} />
  );
}
