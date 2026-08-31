/** PostgREST `.in()` rides on the query string. ~100 UUIDs stay inside typical URL limits. */
export const POSTGREST_IN_CHUNK = 100;

export function chunkIds<T>(ids: readonly T[], size = POSTGREST_IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

export async function fetchAllIn<T>(
  ids: readonly string[],
  load: (chunk: string[]) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const parts = await Promise.all(chunkIds(ids).map((chunk) => load(chunk)));
  const rows: T[] = [];
  for (const part of parts) {
    if (part.error) throw part.error;
    if (part.data?.length) rows.push(...part.data);
  }
  return rows;
}
