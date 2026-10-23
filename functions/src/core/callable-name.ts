import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<string>();

/** Lane dispatch sets the inner name. A direct callable falls back to its own target. */
export function activeCallableName(): string | undefined {
  return store.getStore() ?? process.env.FUNCTION_TARGET ?? process.env.K_SERVICE;
}

export function runWithCallableName<T>(name: string, work: () => Promise<T>): Promise<T> {
  return store.run(name, work);
}
