export type ScannedFn = {
  name: string;
  start: number;
  end: number;
  brace: number;
  async: boolean;
  asyncInsertAt: number;
  signature: string;
  body: string;
  maskedBody: string;
};

const SKIP_CALLEE = new Set([
  "map",
  "weakmap",
  "set",
  "weakset",
  "headers",
  "urlsearchparams",
  "searchparams",
  "cookies",
  "cache",
  "queryclient",
  "createhmac",
  "createhash",
  "createcipheriv",
  "createdecipheriv",
  "createsign",
  "createverify",
  "domutil",
  "buffer",
  "uint8array",
  "uint8clampedarray",
  "dataview",
  "formdata",
  "url",
  "json",
  "object",
  "array",
  "promise",
  "math",
  "date",
  "number",
  "string",
  "blob",
]);

const CALL_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "await",
  "new",
  "typeof",
  "void",
  "delete",
  "in",
  "of",
  "do",
  "case",
]);

const DIRECT_WRITE =
  /\b(?:tx|(?:[A-Za-z_$][\w$]*)?[Bb]atch|(?:[A-Za-z_$][\w$]*)?[Ww]riter)\s*\.\s*(?:set|update|delete)\s*\(|\b[A-Za-z_$][\w$]*[Rr]ef\s*\.\s*(?:set|update|delete|create)\s*\(|\bbulkWriter\s*\(|\b(?:createUser|updateUser|deleteUser|revokeRefreshTokens)\s*\(/;

export function maskNonCode(source: string): string {
  const out = source.split("");
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      out[index] = " ";
      out[index + 1] = " ";
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        out[index] = " ";
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      out[index] = " ";
      out[index + 1] = " ";
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] !== "\n") out[index] = " ";
        index += 1;
      }
      if (index < source.length) {
        out[index] = " ";
        out[index + 1] = " ";
        index += 2;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      out[index] = " ";
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          out[index] = " ";
          if (index + 1 < source.length && source[index + 1] !== "\n") out[index + 1] = " ";
          index += 2;
          continue;
        }
        if (quote === "`" && source[index] === "$" && source[index + 1] === "{") {
          out[index] = " ";
          out[index + 1] = " ";
          index += 2;
          let depth = 1;
          while (index < source.length && depth > 0) {
            if (source[index] === "{") depth += 1;
            else if (source[index] === "}") {
              depth -= 1;
              if (depth === 0) out[index] = " ";
            }
            index += 1;
          }
          continue;
        }
        if (source[index] === quote) {
          out[index] = " ";
          index += 1;
          break;
        }
        if (source[index] !== "\n") out[index] = " ";
        index += 1;
      }
      continue;
    }
    index += 1;
  }
  return out.join("");
}

function braceDepths(masked: string): number[] {
  const depth = new Array<number>(masked.length);
  let current = 0;
  for (let index = 0; index < masked.length; index += 1) {
    depth[index] = current;
    if (masked[index] === "{") current += 1;
    else if (masked[index] === "}") current = Math.max(0, current - 1);
  }
  return depth;
}

function skipSpace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor] ?? "")) cursor += 1;
  return cursor;
}

function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function skipGeneric(text: string, index: number): number {
  if (text[index] !== "<") return index;
  let angle = 0;
  let brace = 0;
  let paren = 0;
  for (let cursor = index; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === "<") angle += 1;
    else if (char === ">") {
      angle -= 1;
      if (angle === 0 && brace === 0 && paren === 0) return cursor + 1;
    } else if (char === "{") brace += 1;
    else if (char === "}") brace -= 1;
    else if (char === "(") paren += 1;
    else if (char === ")") paren -= 1;
  }
  return index;
}

function skipType(text: string, index: number): number {
  let cursor = skipSpace(text, index);
  if (text[cursor] === "<") cursor = skipGeneric(text, cursor);
  cursor = skipSpace(text, cursor);
  let angle = 0;
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "<") angle += 1;
    else if (char === ">") angle = Math.max(0, angle - 1);
    else if (char === "(") paren += 1;
    else if (char === ")") paren = Math.max(0, paren - 1);
    else if (char === "[") bracket += 1;
    else if (char === "]") bracket = Math.max(0, bracket - 1);
    else if (char === "{") {
      if (angle === 0 && paren === 0 && bracket === 0) {
        const previous = text[skipSpaceBackward(text, cursor - 1)];
        if (previous === ">" || previous === ")") return cursor;
        if (previous !== ":" && previous !== "&" && previous !== "|" && previous !== "=" && previous !== "," && previous !== "<" && previous !== "(") {
          return cursor;
        }
      }
      brace += 1;
    } else if (char === "}") {
      brace = Math.max(0, brace - 1);
    } else if (char === "=" && text[cursor + 1] === ">" && angle === 0 && brace === 0 && paren === 0 && bracket === 0) {
      return cursor;
    }
    cursor += 1;
  }
  return cursor;
}

function skipSpaceBackward(text: string, index: number): number {
  let cursor = index;
  while (cursor >= 0 && /\s/.test(text[cursor] ?? "")) cursor -= 1;
  return cursor;
}

function readParams(text: string, index: number): number {
  const cursor = skipSpace(text, index);
  if (text[cursor] !== "(") return -1;
  return matchParen(text, cursor);
}

type Header = {
  name: string;
  async: boolean;
  signature: string;
  brace: number;
  end: number;
  asyncInsertAt: number;
};

function headerAfterName(
  text: string,
  nameEnd: number,
  asyncFlag: boolean,
  name: string,
  asyncInsertAt: number,
): Header | null {
  let cursor = skipSpace(text, nameEnd);
  cursor = skipGeneric(text, cursor);
  const paren = readParams(text, cursor);
  if (paren < 0) return null;
  let after = skipSpace(text, paren + 1);
  if (text[after] === ":") after = skipType(text, after + 1);
  after = skipSpace(text, after);
  if (text[after] !== "{") return null;
  const end = matchBrace(text, after);
  if (end < 0) return null;
  return {
    name,
    async: asyncFlag,
    signature: text.slice(nameEnd, after),
    brace: after,
    end,
    asyncInsertAt,
  };
}

function isIdentStart(char: string | undefined): boolean {
  return char != null && /[A-Za-z_$]/.test(char);
}

function readIdent(text: string, index: number): string {
  let cursor = index;
  while (cursor < text.length && /[\w$]/.test(text[cursor] ?? "")) cursor += 1;
  return text.slice(index, cursor);
}

export function splitTopLevelFunctions(source: string): ScannedFn[] {
  const masked = maskNonCode(source);
  const depth = braceDepths(masked);
  const found: ScannedFn[] = [];
  let index = 0;
  while (index < masked.length) {
    if ((depth[index] ?? 0) !== 0) {
      index += 1;
      continue;
    }
    const header = matchFunctionAt(masked, index) ?? matchArrowAt(masked, index);
    if (!header) {
      index += 1;
      continue;
    }
    found.push({
      name: header.name,
      start: index,
      end: header.end,
      brace: header.brace,
      async: header.async,
      asyncInsertAt: header.asyncInsertAt,
      signature: header.signature,
      body: source.slice(header.brace, header.end + 1),
      maskedBody: masked.slice(header.brace, header.end + 1),
    });
    index = header.end + 1;
  }
  return found;
}

function matchFunctionAt(text: string, index: number): Header | null {
  if (!text.startsWith("function", index)) return null;
  if (index > 0 && /[\w$]/.test(text[index - 1] ?? "")) return null;
  if (/[\w$]/.test(text[index + "function".length] ?? "")) return null;
  let cursor = skipSpace(text, index + "function".length);
  if (!isIdentStart(text[cursor])) return null;
  const name = readIdent(text, cursor);
  cursor += name.length;
  const before = text.slice(Math.max(0, index - 24), index);
  const asyncFlag = /\basync\s*$/.test(before);
  return headerAfterName(text, cursor, asyncFlag, name, index);
}

function matchArrowAt(text: string, index: number): Header | null {
  if (!text.startsWith("const", index) && !text.startsWith("let", index) && !text.startsWith("var", index)) {
    return null;
  }
  if (index > 0 && /[\w$]/.test(text[index - 1] ?? "")) return null;
  const keyword = text.startsWith("const", index) ? "const" : text.startsWith("let", index) ? "let" : "var";
  if (/[\w$]/.test(text[index + keyword.length] ?? "")) return null;
  let cursor = skipSpace(text, index + keyword.length);
  if (!isIdentStart(text[cursor])) return null;
  const name = readIdent(text, cursor);
  cursor = skipSpace(text, cursor + name.length);
  if (text[cursor] !== "=") return null;
  cursor = skipSpace(text, cursor + 1);
  let asyncFlag = false;
  if (text.startsWith("async", cursor) && !/[\w$]/.test(text[cursor + 5] ?? "")) {
    asyncFlag = true;
    cursor = skipSpace(text, cursor + 5);
  }
  if (text.startsWith("function", cursor) && !/[\w$]/.test(text[cursor + 8] ?? "")) {
    cursor = skipSpace(text, cursor + 8);
    if (isIdentStart(text[cursor])) cursor += readIdent(text, cursor).length;
    return headerAfterName(text, cursor, asyncFlag, name, cursor);
  }
  cursor = skipGeneric(text, cursor);
  const parenOpen = skipSpace(text, cursor);
  const paren = readParams(text, cursor);
  if (paren < 0) return null;
  let after = skipSpace(text, paren + 1);
  if (text[after] === ":") after = skipType(text, after + 1);
  after = skipSpace(text, after);
  if (text[after] !== "=" || text[after + 1] !== ">") return null;
  after = skipSpace(text, after + 2);
  if (text[after] !== "{") return null;
  const end = matchBrace(text, after);
  if (end < 0) return null;
  return {
    name,
    async: asyncFlag,
    signature: text.slice(parenOpen, after),
    brace: after,
    end,
    asyncInsertAt: parenOpen,
  };
}

function calleeNameBefore(text: string, openParen: number): string {
  let cursor = skipSpaceBackward(text, openParen - 1);
  if (text[cursor] === ".") cursor = skipSpaceBackward(text, cursor - 1);
  if (!/[\w$]/.test(text[cursor] ?? "")) return "";
  let start = cursor;
  while (start > 0 && /[\w$]/.test(text[start - 1] ?? "")) start -= 1;
  return text.slice(start, cursor + 1);
}

function hasChainedWrite(maskedBody: string): boolean {
  const pattern = /\)\s*\.\s*(?:set|update|delete|create)\s*\(/g;
  let match = pattern.exec(maskedBody);
  while (match) {
    const closeParen = match.index;
    const open = matchParenBackward(maskedBody, closeParen);
    if (open >= 0) {
      const name = calleeNameBefore(maskedBody, open).toLowerCase();
      if (!name) {
        const inner = maskedBody.slice(open + 1, closeParen);
        if (!/\b(?:Map|WeakMap|URLSearchParams|Headers|cookies|createHmac|createHash|createSign|createVerify)\b/.test(inner)) {
          return true;
        }
      } else if (!SKIP_CALLEE.has(name)) {
        return true;
      }
    }
    match = pattern.exec(maskedBody);
  }
  return false;
}

function matchParenBackward(text: string, close: number): number {
  let depth = 0;
  for (let index = close; index >= 0; index -= 1) {
    if (text[index] === ")") depth += 1;
    else if (text[index] === "(") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function hasCollectionDocWrite(maskedBody: string): boolean {
  const pattern = /\.collection\s*\(/g;
  let match = pattern.exec(maskedBody);
  while (match) {
    const open = match.index + match[0].length - 1;
    const close = matchParen(maskedBody, open);
    if (close < 0) return false;
    let cursor = skipSpace(maskedBody, close + 1);
    if (maskedBody.startsWith(".doc", cursor)) {
      cursor = skipSpace(maskedBody, cursor + 4);
      if (maskedBody[cursor] === "(") {
        const docClose = matchParen(maskedBody, cursor);
        if (docClose >= 0) {
          cursor = skipSpace(maskedBody, docClose + 1);
          if (/^\.(?:set|update|delete|create)\s*\(/.test(maskedBody.slice(cursor))) return true;
        }
      }
    }
    match = pattern.exec(maskedBody);
  }
  return false;
}

function hasFromWrite(maskedBody: string): boolean {
  const pattern = /\.from\s*\(/g;
  let match = pattern.exec(maskedBody);
  while (match) {
    const open = match.index + match[0].length - 1;
    const close = matchParen(maskedBody, open);
    if (close < 0) return false;
    let cursor = close + 1;
    while (cursor < maskedBody.length) {
      cursor = skipSpace(maskedBody, cursor);
      if (maskedBody[cursor] !== ".") break;
      cursor = skipSpace(maskedBody, cursor + 1);
      const method = readIdent(maskedBody, cursor);
      if (!method) break;
      cursor += method.length;
      cursor = skipSpace(maskedBody, cursor);
      if (maskedBody[cursor] !== "(") break;
      const methodClose = matchParen(maskedBody, cursor);
      if (methodClose < 0) return false;
      if (method === "update" || method === "insert" || method === "delete" || method === "upsert") {
        return true;
      }
      cursor = methodClose + 1;
    }
    match = pattern.exec(maskedBody);
  }
  return false;
}

function hasAssignedDocWrite(maskedBody: string): boolean {
  const declared = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;{]+)/g;
  let match = declared.exec(maskedBody);
  while (match) {
    const name = match[1] ?? "";
    const initializer = match[2] ?? "";
    if (/\.batch\s*\(|\.doc\s*\(|\.bulkWriter\s*\(/.test(initializer)) {
      const use = new RegExp(`\\b${name}\\s*\\.\\s*(?:set|update|delete|create)\\s*\\(`);
      if (use.test(maskedBody)) return true;
    }
    match = declared.exec(maskedBody);
  }
  return false;
}

export function functionHasWrite(maskedBody: string): boolean {
  if (DIRECT_WRITE.test(maskedBody)) return true;
  if (hasChainedWrite(maskedBody)) return true;
  if (hasCollectionDocWrite(maskedBody)) return true;
  if (hasFromWrite(maskedBody)) return true;
  return hasAssignedDocWrite(maskedBody);
}

export function calledNames(maskedBody: string): string[] {
  const names: string[] = [];
  const pattern = /([A-Za-z_$][\w$]*)\s*\(/g;
  let match = pattern.exec(maskedBody);
  while (match) {
    const name = match[1] ?? "";
    const before = maskedBody[match.index - 1];
    if (before !== "." && !CALL_KEYWORDS.has(name)) names.push(name);
    match = pattern.exec(maskedBody);
  }
  return names;
}

export function functionIsGated(fn: ScannedFn, byName: Map<string, ScannedFn>): boolean {
  if (fn.maskedBody.includes("requireMutationAuth")) return true;
  for (const name of calledNames(fn.maskedBody)) {
    const callee = byName.get(name);
    if (callee?.maskedBody.includes("requireMutationAuth")) return true;
  }
  return false;
}

export function lineOf(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index && cursor < source.length; cursor += 1) {
    if (source[cursor] === "\n") line += 1;
  }
  return line;
}
