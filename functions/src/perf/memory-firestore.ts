type Data = Record<string, unknown>;

type Snap = {
  id: string;
  exists: boolean;
  get: (field: string) => unknown;
  data: () => Data | undefined;
};

type DocRef = {
  id: string;
  path: string;
  get: () => Promise<Snap>;
  set: (data: Data, options?: { merge?: boolean }) => Promise<void>;
  collection: (name: string) => CollectionRef;
};

type CollectionRef = {
  doc: (id?: string) => DocRef;
};

function sentinelKind(value: unknown): "increment" | "timestamp" | null {
  if (typeof value !== "object" || value === null) return null;
  const name = (value as { methodName?: unknown }).methodName;
  if (name === "FieldValue.increment") return "increment";
  if (name === "FieldValue.serverTimestamp") return "timestamp";
  return null;
}

function applyPatch(prev: Data, patch: Data, merge: boolean): Data {
  const next: Data = merge ? { ...prev } : {};
  for (const [key, value] of Object.entries(patch)) {
    const kind = sentinelKind(value);
    if (kind === "increment") {
      const operand = (value as { operand?: unknown }).operand;
      const amount = typeof operand === "number" ? operand : 0;
      const current = typeof next[key] === "number" ? (next[key] as number) : 0;
      next[key] = current + amount;
      continue;
    }
    if (kind === "timestamp") {
      next[key] = new Date();
      continue;
    }
    next[key] = value;
  }
  return next;
}

function snapshot(id: string, data: Data | undefined): Snap {
  const copy = data ? { ...data } : undefined;
  return {
    id,
    exists: copy !== undefined,
    get: (field) => (copy ? copy[field] : undefined),
    data: () => (copy ? { ...copy } : undefined),
  };
}

type TxSet = (ref: DocRef, data: Data, options?: { merge?: boolean }) => void;

export type MemoryFirestore = {
  collection: (name: string) => CollectionRef;
  runTransaction: <T>(fn: (tx: { get: (ref: DocRef) => Promise<Snap>; set: TxSet }) => Promise<T>) => Promise<T>;
  dump: () => Map<string, Data>;
};

export function createMemoryFirestore(): MemoryFirestore {
  const docs = new Map<string, Data>();
  let auto = 0;

  function docRef(collection: string, id: string): DocRef {
    const path = `${collection}/${id}`;
    return {
      id,
      path,
      async get() {
        return snapshot(id, docs.get(path));
      },
      async set(data, options) {
        const prev = docs.get(path) ?? {};
        docs.set(path, applyPatch(prev, data, options?.merge === true));
      },
      collection(name) {
        return collectionRef(`${path}/${name}`);
      },
    };
  }

  function collectionRef(name: string): CollectionRef {
    return {
      doc(id) {
        auto += 1;
        return docRef(name, id ?? `auto-${auto}`);
      },
    };
  }

  return {
    collection: collectionRef,
    async runTransaction(fn) {
      const pending: Array<() => Promise<void>> = [];
      const tx = {
        get: (ref: DocRef) => ref.get(),
        set(ref: DocRef, data: Data, options?: { merge?: boolean }) {
          pending.push(() => ref.set(data, options));
        },
      };
      const result = await fn(tx);
      for (const write of pending) await write();
      return result;
    },
    dump: () => docs,
  };
}
