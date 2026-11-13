/**
 * A read the page shell makes for itself, as a plain GET.
 *
 * Next sends one tab's server actions one at a time. The shell (sidebar badges,
 * the import banner) mounts before the page, so when its reads were server
 * actions the page's own data queued behind them on every page load. A fetch is
 * not in that queue. The session cookie goes with it, and each route checks the
 * caller itself.
 */
export async function panelGet<T>(url: string): Promise<T> {
  return answerOf<T>(
    await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    }),
  );
}

/**
 * The same, for a read whose question does not belong in the address (a search
 * the operator typed, a set of filters). Still a read; still outside the queue.
 */
export async function panelPost<T>(url: string, question: unknown): Promise<T> {
  return answerOf<T>(
    await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(question),
    }),
  );
}

async function answerOf<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (!response.ok || body == null) {
    const code = body && typeof body === "object" && "error" in body ? String(body.error) : `http_${response.status}`;
    throw new Error(code);
  }
  return body as T;
}
