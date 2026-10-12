/** Read-only facade. Every write method throws before it can reach Firestore. */

const WRITE = [
  "set",
  "update",
  "create",
  "delete",
  "add",
  "commit",
  "flush",
  "runTransaction",
  "bulkWriter",
  "sendEach",
];

function throwWrite(name) {
  return () => {
    throw new Error(`dry_run_write:${name}`);
  };
}

export function readOnlyQuery(query) {
  return {
    where: (...args) => readOnlyQuery(query.where(...args)),
    select: (...args) => readOnlyQuery(query.select(...args)),
    limit: (...args) => readOnlyQuery(query.limit(...args)),
    orderBy: (...args) => readOnlyQuery(query.orderBy(...args)),
    get: () => query.get(),
    count: () => ({ get: () => query.count().get() }),
    doc: (id) => readOnlyDoc(query.doc(id)),
    add: throwWrite("add"),
  };
}

export function readOnlyDoc(ref) {
  return {
    get: () => ref.get(),
    collection: (name) => readOnlyQuery(ref.collection(name)),
    set: throwWrite("set"),
    update: throwWrite("update"),
    create: throwWrite("create"),
    delete: throwWrite("delete"),
  };
}

export function readOnlyDb(db) {
  const facade = {
    collection: (name) => readOnlyQuery(db.collection(name)),
    getAll: (...refs) => db.getAll(...refs),
  };
  for (const name of WRITE) facade[name] = throwWrite(name);
  return facade;
}
