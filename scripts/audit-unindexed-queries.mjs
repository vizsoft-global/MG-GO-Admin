/**
 * Read-only audit: which queries in the code have no index to answer them?
 *
 * The database is Firestore **Enterprise** edition. Unlike Standard edition it
 * creates no index by default, not even the single-field ones, and a query with
 * no matching index is answered by reading the whole collection, billed by the
 * amount of data read. `where("external_order_id", "==", x)` on `deliveries`
 * therefore costs one pass over every delivery ever stored.
 *
 * This walks the TypeScript sources, collects every query it can see
 * (collection, equality fields, range/order fields), and checks each against an
 * index list: the live one (`firebase firestore:indexes` output saved to a file)
 * or `firestore.indexes.json`.
 *
 *   node scripts/audit-unindexed-queries.mjs [--indexes <file>] [--json <out>] [--write]
 *
 * `--write` adds the missing definitions to `firestore.indexes.json`; deploying
 * them is a separate, deliberate step. Touches no database. A query assembled across several statements is
 * reported with the fields seen on that variable, marked `dynamic`.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : null;
};
const indexFile = flag("--indexes") ?? path.join(root, "firestore.indexes.json");
const jsonOut = flag("--json");
const write = args.includes("--write");

/**
 * Left out on purpose: a field rewritten on every GPS report, on a collection of
 * one small document per rider, asked for by a cleanup job a few times a day.
 * Reading that collection is cheaper than keeping the index current.
 */
const SKIP = new Set(["driver_locations|last_seen_at", "driver_device_sessions|last_seen_at"]);

const EQUALITY = new Set(["==", "in", "array-contains", "array-contains-any"]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "lib" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/**
 * The exported constant tables (`COLLECTIONS`, `FIELDS`) as real values, by
 * compiling the two modules that define them. They import nothing at runtime.
 */
function constantTables() {
  const tables = {};
  for (const file of ["src/lib/firebase/db.ts", "functions/src/core/collections.ts"]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    try {
      const compiled = ts.transpileModule(fs.readFileSync(full, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      const exported = {};
      new Function("exports", "require", compiled)(exported, () => ({}));
      for (const [name, value] of Object.entries(exported)) {
        if (value && typeof value === "object") tables[name] = { ...(tables[name] ?? {}), ...value };
        else if (typeof value === "string") tables[name] = value;
      }
    } catch {
      // A module that cannot be evaluated alone leaves its names unresolved.
    }
  }
  return tables;
}

const TABLES = constantTables();

/** The value a name or `A.b.c` stands for, or undefined. */
function valueOf(node, constants) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return valueOf(node.expression, constants);
  if (ts.isIdentifier(node)) return constants.has(node.text) ? constants.get(node.text) : TABLES[node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const owner = valueOf(node.expression, constants);
    return owner && typeof owner === "object" ? owner[node.name.text] : undefined;
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    const owner = valueOf(node.expression, constants);
    return owner && typeof owner === "object" ? owner[node.argumentExpression.text] : undefined;
  }
  return undefined;
}

function literal(node, constants) {
  if (!node) return null;
  const value = valueOf(node, constants);
  if (typeof value === "string") return value;
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isIdentifier(node)) return `<${node.getText()}>`;
  return null;
}

/** Top-level `const NAME = "text"` or `const NAME = FIELDS.deliveries`, so later reads resolve. */
function fileConstants(source) {
  const constants = new Map();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const value = valueOf(declaration.initializer, constants);
      if (typeof value === "string" || (value && typeof value === "object")) constants.set(declaration.name.text, value);
    }
  }
  return constants;
}

/** Unwinds `a.b(...).c(...)` into its calls, innermost first, and the root expression. */
function chainOf(node) {
  const calls = [];
  let current = node;
  while (true) {
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      calls.unshift({ name: current.expression.name.text, args: current.arguments, node: current });
      current = current.expression.expression;
    } else if (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
    } else break;
  }
  return { calls, rootNode: current };
}

function scanFile(file) {
  const text = fs.readFileSync(file, "utf8");
  if (!/\.(where|orderBy)\(/.test(text)) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const constants = fileConstants(source);
  const relative = path.relative(root, file).split(path.sep).join("/");
  const found = [];
  const seen = new Set();
  /** variable name -> { collection, eq:Set, range:Set, order:[], line } for queries built across statements. */
  const variables = new Map();

  const apply = (shape, calls) => {
    for (const call of calls) {
      if (call.name === "where") {
        const field = literal(call.args[0], constants);
        const op = literal(call.args[1], constants);
        if (!field) continue;
        if (op && EQUALITY.has(op)) {
          shape.eq.add(field);
          if (op.startsWith("array-contains")) shape.array.add(field);
        } else shape.range.add(field);
      } else if (call.name === "orderBy") {
        const field = literal(call.args[0], constants);
        if (field) shape.order.push(field);
        if (field && literal(call.args[1], constants) === "desc") shape.desc.add(field);
      } else if (call.name === "limit") shape.limit = true;
      else if (call.name === "count") shape.count = true;
    }
  };

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      // Only the outermost call of a chain.
      const parent = node.parent;
      const inner = parent && ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.parent && ts.isCallExpression(parent.parent);
      if (!inner) {
        const { calls, rootNode } = chainOf(node);
        const names = calls.map((call) => call.name);
        if (names.includes("where") || names.includes("orderBy")) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const at = names.findIndex((name) => name === "collection" || name === "collectionGroup");
          if (at >= 0) {
            const shape = { file: relative, line, collection: literal(calls[at].args[0], constants) ?? "?", eq: new Set(), array: new Set(), desc: new Set(), range: new Set(), order: [], dynamic: false };
            apply(shape, calls.slice(at + 1));
            // `let q = db.collection(x).where(...)` then `q = q.where(...)`.
            const declaration = node.parent;
            if (declaration && ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) variables.set(declaration.name.text, shape);
            if (declaration && ts.isBinaryExpression(declaration) && ts.isIdentifier(declaration.left)) variables.set(declaration.left.text, shape);
            const key = `${shape.file}:${shape.line}`;
            if (!seen.has(key)) {
              seen.add(key);
              found.push(shape);
            }
          } else if (ts.isIdentifier(rootNode) && variables.has(rootNode.text)) {
            const shape = variables.get(rootNode.text);
            shape.dynamic = true;
            apply(shape, calls);
          }
        }
      }
    }
    // A bare `const q = db.collection(x)` that is filtered later.
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const { calls } = chainOf(node.initializer);
      const names = calls.map((call) => call.name);
      const at = names.findIndex((name) => name === "collection" || name === "collectionGroup");
      if (at >= 0 && !names.includes("where") && !names.includes("orderBy") && !names.includes("doc")) {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const shape = { file: relative, line, collection: literal(calls[at].args[0], constants) ?? "?", eq: new Set(), array: new Set(), desc: new Set(), range: new Set(), order: [], dynamic: true, bare: true };
        variables.set(node.name.text, shape);
        found.push(shape);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.filter((shape) => !(shape.bare && shape.eq.size === 0 && shape.range.size === 0 && shape.order.length === 0));
}

function loadIndexes(file) {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw.slice(raw.indexOf("{")));
  return (parsed.indexes ?? []).map((index) => ({
    collection: index.collectionGroup,
    fields: index.fields.map((field) => field.fieldPath),
  }));
}

/** The fields an index must lead with: the equality fields in any order, then the range / order field. */
function needs(shape) {
  const eq = [...shape.eq];
  const tail = [];
  for (const field of [...shape.range, ...shape.order]) {
    if (!shape.eq.has(field) && !tail.includes(field) && field !== "__name__") tail.push(field);
  }
  return { eq, tail };
}

function covered(shape, indexes) {
  const { eq, tail } = needs(shape);
  if (eq.length === 0 && tail.length === 0) return true;
  return indexes.some((index) => {
    if (index.collection !== shape.collection) return false;
    const head = index.fields.slice(0, eq.length);
    if (eq.length > 0 && !(head.length === eq.length && eq.every((field) => head.includes(field)))) return false;
    // A dynamic query's range/order may or may not be applied; leading with the equality fields is enough.
    if (tail.length === 0 || shape.dynamic) return true;
    return index.fields[eq.length] === tail[0];
  });
}

const indexes = loadIndexes(indexFile);
const files = [...walk(path.join(root, "functions/src")), ...walk(path.join(root, "src"))];
const shapes = files.flatMap(scanFile);
const missing = shapes.filter((shape) => !shape.collection.startsWith("<") && shape.collection !== "?" && !covered(shape, indexes));
const unresolved = shapes.filter((shape) => shape.collection.startsWith("<") || shape.collection === "?");

const byIndex = new Map();
for (const shape of missing) {
  const { eq, tail } = needs(shape);
  const fields = [...eq.sort(), ...(shape.dynamic ? [] : tail.slice(0, 1))];
  const last = shape.dynamic ? null : tail[0];
  const descending = Boolean(last && shape.desc.has(last) && !shape.range.has(last));
  const key = `${shape.collection}|${fields.join(",")}${descending ? "|desc" : ""}`;
  const entry = byIndex.get(key) ?? { collection: shape.collection, fields, array: new Set(), descending, dynamicOnly: true, uses: [] };
  for (const field of shape.array) entry.array.add(field);
  if (!shape.dynamic) entry.dynamicOnly = false;
  entry.uses.push(`${shape.file}:${shape.line}${shape.dynamic ? " (dynamic)" : ""}`);
  byIndex.set(key, entry);
}
const wanted = [...byIndex.values()].sort((a, b) => a.collection.localeCompare(b.collection) || a.fields.join().localeCompare(b.fields.join()));

/** One definition in the shape `firestore.indexes.json` holds, or null when it cannot be written safely. */
function definition(entry) {
  if (entry.fields.length === 0 || entry.fields.some((field) => field.startsWith("<"))) return null;
  // A query whose filters are added one by one at run time has no single shape to index.
  if (entry.dynamicOnly && entry.fields.length > 1) return null;
  if (SKIP.has(`${entry.collection}|${entry.fields.join(",")}`)) return null;
  const fields = entry.fields.map((field, at) => {
    if (entry.array.has(field)) return { fieldPath: field, arrayConfig: "CONTAINS" };
    const lastDescending = entry.descending && at === entry.fields.length - 1;
    return { fieldPath: field, order: lastDescending ? "DESCENDING" : "ASCENDING" };
  });
  // The form the two hand-made single-field indexes on `drivers` already use.
  if (fields.length === 1) fields.push({ fieldPath: "__name__", order: "ASCENDING" });
  return { collectionGroup: entry.collection, queryScope: "COLLECTION", fields };
}

const definitions = wanted.map(definition).filter(Boolean);

console.log(`index list: ${path.relative(root, indexFile) || indexFile} (${indexes.length} indexes)`);
console.log(`queries found: ${shapes.length} in ${files.length} files | no index: ${missing.length} | collection not resolved: ${unresolved.length}`);
console.log(`distinct indexes missing: ${wanted.length} | definitions that can be written: ${definitions.length}
`);
for (const entry of wanted) {
  console.log(`${entry.collection}  [${entry.fields.join(", ")}]${entry.descending ? " desc" : ""}  x${entry.uses.length}${definition(entry) ? "" : "  (not written)"}`);
  for (const use of entry.uses.slice(0, 4)) console.log(`    ${use}`);
  if (entry.uses.length > 4) console.log(`    … ${entry.uses.length - 4} more`);
}
if (jsonOut) {
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        wanted: wanted.map((entry) => ({ ...entry, array: [...entry.array], written: Boolean(definition(entry)) })),
        definitions,
        unresolved: unresolved.map((shape) => `${shape.file}:${shape.line} ${shape.collection}`),
      },
      null,
      2,
    ),
  );
}
if (write) {
  const target = path.join(root, "firestore.indexes.json");
  const current = JSON.parse(fs.readFileSync(target, "utf8"));
  const keyOf = (index) => `${index.collectionGroup}|${index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(",")}`;
  const have = new Set(current.indexes.map(keyOf));
  const added = definitions.filter((index) => !have.has(keyOf(index)));
  current.indexes.push(...added);
  fs.writeFileSync(target, `${JSON.stringify(current, null, 2)}
`);
  console.log(`
wrote ${added.length} definitions to firestore.indexes.json (${current.indexes.length} in the file now)`);
}
