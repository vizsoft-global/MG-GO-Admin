/** Auth retries 520/522/504 until the 300s function cap; give up before that. */
export const SUPABASE_DEADLINE_MS = 2_000;

/** Cap a thenable so a hung fetch cannot hold the request open. */
export async function settledWithin<T>(
  thenable: PromiseLike<T>,
  ms: number,
): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: false }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false }), ms);
  });
  try {
    const winner = await Promise.race([
      Promise.resolve(thenable).then((value) => ({ ok: true as const, value })),
      timeout,
    ]);
    return winner;
  } catch {
    return { ok: false };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
