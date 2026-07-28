import * as Sentry from "@sentry/nextjs";
import { getBaseSentryOptions } from "@/lib/sentry/options";

Sentry.init({
  ...getBaseSentryOptions(),
  includeLocalVariables: true,
});
