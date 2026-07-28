export function getSentryEnvironment(): string {
  return process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development";
}

export function getTracesSampleRate(): number {
  return process.env.NODE_ENV === "development" ? 1.0 : 0.1;
}

export function getBaseSentryOptions() {
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: getSentryEnvironment(),
    tracesSampleRate: getTracesSampleRate(),
    sendDefaultPii: false,
  };
}
