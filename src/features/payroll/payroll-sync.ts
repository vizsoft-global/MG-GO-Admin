/**
 * "Something changed in payroll, refresh what you are showing."
 *
 * Payroll and HR Payroll are separate routes, so the HR query is unmounted while
 * an operator edits an order on the Payroll tab; coming back would read the cache
 * the edit never touched. A write notifies every open tab through a
 * `BroadcastChannel` (with a `storage` event fallback), and each page invalidates
 * its own queries — no server broadcast, no polling, and two windows converge
 * within a frame.
 */
const CHANNEL = "payroll-sync";

type Listener = () => void;

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null | undefined;

function sharedChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    channel = null;
    return channel;
  }
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = () => {
    for (const listener of listeners) listener();
  };
  return channel;
}

/**
 * Announce a payroll/HR write. Call after a successful save; the local listeners
 * are **not** fired (the writer already invalidates its own queries), so a tab
 * does not refetch twice.
 */
export function notifyPayrollWrite(): void {
  sharedChannel()?.postMessage({ at: Date.now() });
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CHANNEL, String(Date.now()));
    } catch {
      // A browser with storage disabled still has the channel; nothing to do.
    }
  }
}

/** Subscribe to writes from another tab. Returns the unsubscribe function. */
export function subscribePayrollWrites(listener: Listener): () => void {
  sharedChannel();
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === CHANNEL) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
