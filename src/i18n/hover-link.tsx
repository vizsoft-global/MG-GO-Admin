"use client";

import { useState, type ComponentProps } from "react";
import { BaseLink } from "./navigation-base";

type LinkProps = ComponentProps<typeof BaseLink>;

/**
 * What a link should prefetch: the caller's explicit choice if there is one,
 * otherwise nothing until the pointer (or focus, or a finger) reaches it, and
 * the framework default after that.
 */
export function resolvePrefetch<T>(explicit: T | undefined, warm: boolean): T | null | false {
  if (explicit !== undefined) return explicit;
  return warm ? null : false;
}

/**
 * The panel's link: it loads its page when the user reaches for it, not when it
 * scrolls into view.
 *
 * Every route here is dynamic and behind the session check, so a prefetch is a
 * server function run. Left to the default, a list of fifty employees started
 * fifty of them the moment it rendered, and the sidebar started one for every
 * menu page on every page load. The operator opens one link. Hover, focus and
 * touch all count as reaching for it, so a click still finds the page warm.
 * A caller that passes `prefetch` keeps exactly what it asked for.
 */
export function Link({ prefetch, onMouseEnter, onFocus, onTouchStart, ...rest }: LinkProps) {
  const [warm, setWarm] = useState(false);
  return (
    <BaseLink
      {...(rest as LinkProps)}
      prefetch={resolvePrefetch(prefetch, warm) as LinkProps["prefetch"]}
      onMouseEnter={(event) => {
        setWarm(true);
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        setWarm(true);
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        setWarm(true);
        onTouchStart?.(event);
      }}
    />
  );
}
