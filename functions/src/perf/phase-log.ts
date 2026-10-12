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

export function logPhases(name: string, phases: PhaseMarks): void {
  try {
    console.info(
      JSON.stringify({
        perf: "phase",
        name,
        requireStaffMs: phases.requireStaffMs ?? null,
        parallelMs: phases.parallelMs ?? null,
        intakesMs: phases.intakesMs ?? null,
        driversGetAllMs: phases.driversGetAllMs ?? null,
      }),
    );
  } catch {
    // Phase logs must never fail the request.
  }
}
