export type PhaseMarks = Record<string, number>;

export async function timedPhase<T>(phases: PhaseMarks, key: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    try {
      phases[key] = Date.now() - started;
    } catch {
      // A broken mark must not replace the request result or its error.
    }
  }
}

const LEGACY_PHASES = ["requireStaffMs", "parallelMs", "intakesMs", "driversGetAllMs"] as const;

export function logPhases(name: string, phases: PhaseMarks): void {
  try {
    const body: Record<string, unknown> = { perf: "phase", name };
    for (const key of LEGACY_PHASES) body[key] = phases[key] ?? null;
    for (const [key, value] of Object.entries(phases)) {
      if (!(key in body)) body[key] = value;
    }
    console.info(JSON.stringify(body));
  } catch {
    // Phase logs must never fail the request.
  }
}
