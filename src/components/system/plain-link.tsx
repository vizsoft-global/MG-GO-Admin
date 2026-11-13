"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * `next/link` for an href that is used as written (it already carries its
 * locale, or relies on the proxy to add one), with prefetch off.
 *
 * Every panel route is dynamic and behind the session check, so the default
 * prefetch is a server function run for each link that scrolls into view. The
 * rider cards on Live Tracking V2 each hold one of these: at the evening peak
 * the list started about seventy rider-profile renders in seven seconds, the
 * session check stopped answering in time, and the page fell back to
 * "Reconnecting your session" in a loop. A caller that passes `prefetch`
 * keeps what it asked for.
 */
export default function Link({ prefetch = false, ...rest }: ComponentProps<typeof NextLink>) {
  return <NextLink {...rest} prefetch={prefetch} />;
}
