/**
 * One request for a page of check-in photos, instead of one per row.
 *
 * Each attendance row used to call a server action for its own photo as it
 * mounted. Next runs a tab's server actions one at a time, so eighty rows meant
 * eighty requests in a queue — and every filter change, click and poll on the
 * page waited behind them. Rows now ask this loader, which collects the keys
 * that arrive in the same tick and sends them together, and remembers the
 * answers so a re-render or the page's own refresh does not ask again.
 */

export type AttendancePhoto = { url: string; contentType: string | null };

export type AttendancePhotoBatch = Record<string, AttendancePhoto | null>;

export type AttendancePhotoFetcher = (keys: string[]) => Promise<AttendancePhotoBatch>;

/** Well inside the signed link's own lifetime, so a remembered link still opens. */
export const ATTENDANCE_PHOTO_CACHE_MS = 10 * 60_000;
/** One action carries at most this many keys; a longer page is sent in turns. */
export const ATTENDANCE_PHOTO_BATCH = 100;

type Waiter = {
  resolve: (photo: AttendancePhoto | null) => void;
  reject: (error: unknown) => void;
};

export function createAttendancePhotoLoader(
  fetcher: AttendancePhotoFetcher,
  options: { now?: () => number; schedule?: (flush: () => void) => void } = {},
) {
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((flush: () => void) => void setTimeout(flush, 0));
  const cache = new Map<string, { at: number; photo: AttendancePhoto | null }>();
  const waiting = new Map<string, Waiter[]>();
  let scheduled = false;

  async function flush(): Promise<void> {
    scheduled = false;
    const keys = [...waiting.keys()];
    for (let index = 0; index < keys.length; index += ATTENDANCE_PHOTO_BATCH) {
      const slice = keys.slice(index, index + ATTENDANCE_PHOTO_BATCH);
      const waiters = slice.map((key) => [key, waiting.get(key) ?? []] as const);
      for (const key of slice) waiting.delete(key);
      try {
        const batch = await fetcher(slice);
        for (const [key, list] of waiters) {
          const photo = batch[key] ?? null;
          // A missing photo is remembered too, or it would be asked for on every render.
          cache.set(key, { at: now(), photo });
          for (const waiter of list) waiter.resolve(photo);
        }
      } catch (error) {
        // Not remembered: the next render may succeed.
        for (const [, list] of waiters) for (const waiter of list) waiter.reject(error);
      }
    }
  }

  return {
    load(key: string): Promise<AttendancePhoto | null> {
      const hit = cache.get(key);
      if (hit && now() - hit.at < ATTENDANCE_PHOTO_CACHE_MS) return Promise.resolve(hit.photo);
      return new Promise((resolve, reject) => {
        const list = waiting.get(key) ?? [];
        list.push({ resolve, reject });
        waiting.set(key, list);
        if (!scheduled) {
          scheduled = true;
          schedule(() => void flush());
        }
      });
    },
    /** For tests. */
    size(): number {
      return cache.size;
    },
  };
}
