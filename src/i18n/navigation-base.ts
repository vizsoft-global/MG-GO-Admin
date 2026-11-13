import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * The locale-aware navigation helpers as next-intl makes them. Application code
 * imports from `./navigation`, which swaps `Link` for the hover-prefetch one.
 */
export const {
  Link: BaseLink,
  redirect,
  usePathname,
  useRouter,
  getPathname,
} = createNavigation(routing);
