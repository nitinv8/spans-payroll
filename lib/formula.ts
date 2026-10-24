// A small, safe, spreadsheet-like formula language (no eval / no JS execution).
// Supports: numbers, "strings", variables, + - * / ^ %, comparisons (= == != <> < <= > >=),
// and / or / not (also && || !), ternary  a ? b : c,  and functions:
// if, min, max, round, roundup, rounddown, ceil, floor, abs, contains, lower, upper, len.

type Tok = { t: "num" | "str" | "id" | "op" | "eof"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (src[j] === "%") { out.push({ t: "num", v: String(Number(src.slice(i, j)) / 100) }); j++; }
      else out.push({ t: "num", v: src.slice(i, j) });
      i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j++;
      if (j >= src.length) throw new Error("Unclosed string");
      out.push({ t: "str", v: src.slice(i + 1, j) });
      i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j; continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "==", "!=", "<>", "&&", "||"].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/^()<>=!?:,".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`Unexpected character "${c}"`);
  }
  out.push({ t: "eof", v: "" });
  return out;
}

export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "var"; name: string }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "tern"; c: Node; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek().t === "op" && peek().v === v;
  const isWord = (v: string) => peek().t === "id" && peek().v.toLowerCase() === v;
  const expect = (v: string) => { if (!isOp(v)) throw new Error(`Expected "${v}"`); p++; };

  const ternary = (): Node => {
    const c = orExpr();
    if (isOp("?")) { p++; const a = ternary(); expect(":"); const b = ternary(); return { k: "tern", c, a, b }; }
    return c;
  };
  const orExpr = (): Node => {
    let a = andExpr();
    while (isOp("||") || isWord("or")) { p++; a = { k: "bin", op: "or", a, b: andExpr() }; }
    return a;
  };
  const andExpr = (): Node => {
    let a = notExpr();
    while (isOp("&&") || isWord("and")) { p++; a = { k: "bin", op: "and", a, b: notExpr() }; }
    return a;
  };
  const notExpr = (): Node => {
    if (isOp("!") || isWord("not")) { p++; return { k: "un", op: "not", a: notExpr() }; }
    return cmp();
  };
  const cmp = (): Node => {
    let a = add();
    while (peek().t === "op" && ["<", "<=", ">", ">=", "=", "==", "!=", "<>"].includes(peek().v)) {
      const op = toks[p++].v;
      a = { k: "bin", op: op === "==" ? "=" : op === "<>" ? "!=" : op, a, b: add() };
    }
    return a;
  };
  const add = (): Node => {
    let a = mul();
    while (isOp("+") || isOp("-")) { const op = toks[p++].v; a = { k: "bin", op, a, b: mul() }; }
    return a;
  };
  const mul = (): Node => {
    let a = unary();
    while (isOp("*") || isOp("/")) { const op = toks[p++].v; a = { k: "bin", op, a, b: unary() }; }
    return a;
  };
  const unary = (): Node => {
    if (isOp("-")) { p++; return { k: "un", op: "-", a: unary() }; }
    if (isOp("+")) { p++; return unary(); }
    return pow();
  };
  const pow = (): Node => {
    const a = primary();
    if (isOp("^")) { p++; return { k: "bin", op: "^", a, b: unary() }; }
    return a;
  };
  const primary = (): Node => {
    const t = peek();
    if (t.t === "num") { p++; const v = Number(t.v); if (Number.isNaN(v)) throw new Error(`Bad number ${t.v}`); return { k: "num", v }; }
    if (t.t === "str") { p++; return { k: "str", v: t.v }; }
    if (t.t === "id") {
      p++;
      const low = t.v.toLowerCase();
      if (low === "true") return { k: "num", v: 1 };
      if (low === "false") return { k: "num", v: 0 };
      if (isOp("(")) {
        p++;
        const args: Node[] = [];
        if (!isOp(")")) { args.push(ternary()); while (isOp(",")) { p++; args.push(ternary()); } }
        expect(")");
        if (!Object.prototype.hasOwnProperty.call(FUNCS, low)) throw new Error(`Unknown function "${t.v}"`);
        return { k: "call", fn: low, args };
      }
      return { k: "var", name: t.v };
    }
    if (isOp("(")) { p++; const e = ternary(); expect(")"); return e; }
    throw new Error(t.t === "eof" ? "Formula ended unexpectedly" : `Unexpected "${t.v}"`);
  };

  const node = ternary();
  if (peek().t !== "eof") throw new Error(`Unexpected "${peek().v}"`);
  return node;
}

type Val = number | string;
const num = (v: Val) => (typeof v === "number" ? v : v.trim() === "" ? 0 : Number(v));
const clean = (n: number) => Math.round(n * 1e9) / 1e9; // kill float noise before rounding
const roundTo = (x: number, d: number, mode: "half" | "up" | "down") => {
  const f = Math.pow(10, d);
  const v = clean(x * f);
  const r = mode === "half" ? Math.sign(v) * Math.round(Math.abs(v)) : mode === "up" ? Math.sign(v) * Math.ceil(Math.abs(v)) : Math.sign(v) * Math.floor(Math.abs(v));
  return r / f;
};

const FUNCS: Record<string, (args: Val[]) => Val> = {
  min: (a) => Math.min(...a.map(num)),
  max: (a) => Math.max(...a.map(num)),
  round: (a) => roundTo(num(a[0]), a.length > 1 ? num(a[1]) : 0, "half"),
  roundup: (a) => roundTo(num(a[0]), a.length > 1 ? num(a[1]) : 0, "up"),
  rounddown: (a) => roundTo(num(a[0]), a.length > 1 ? num(a[1]) : 0, "down"),
  ceil: (a) => Math.ceil(clean(num(a[0]))),
  floor: (a) => Math.floor(clean(num(a[0]))),
  abs: (a) => Math.abs(num(a[0])),
  contains: (a) => (String(a[0]).toLowerCase().includes(String(a[1]).toLowerCase()) ? 1 : 0),
  lower: (a) => String(a[0]).toLowerCase(),
  upper: (a) => String(a[0]).toUpperCase(),
  len: (a) => String(a[0]).length,
  if: () => 0, // handled lazily in evalNode
};

export type Ctx = Record<string, Val>;

export function evalNode(n: Node, ctx: Ctx): Val {
  switch (n.k) {
    case "num": return n.v;
    case "str": return n.v;
    case "var": {
      if (!Object.prototype.hasOwnProperty.call(ctx, n.name)) throw new Error(`Unknown name "${n.name}"`);
      const v = ctx[n.name];
      if (typeof v !== "number" && typeof v !== "string") throw new Error(`"${n.name}" is not a value`);
      return v;
    }
    case "un": {
      const a = evalNode(n.a, ctx);
      return n.op === "-" ? -num(a) : truthy(a) ? 0 : 1;
    }
    case "tern": return truthy(evalNode(n.c, ctx)) ? evalNode(n.a, ctx) : evalNode(n.b, ctx);
    case "call": {
      if (n.fn === "if") {
        if (n.args.length < 2) throw new Error("if(condition, then, else) needs 2-3 arguments");
        return truthy(evalNode(n.args[0], ctx)) ? evalNode(n.args[1], ctx) : n.args[2] ? evalNode(n.args[2], ctx) : 0;
      }
      return FUNCS[n.fn](n.args.map((x) => evalNode(x, ctx)));
    }
    case "bin": {
      if (n.op === "and") return truthy(evalNode(n.a, ctx)) && truthy(evalNode(n.b, ctx)) ? 1 : 0;
      if (n.op === "or") return truthy(evalNode(n.a, ctx)) || truthy(evalNode(n.b, ctx)) ? 1 : 0;
      const a = evalNode(n.a, ctx), b = evalNode(n.b, ctx);
      if (n.op === "=" ) return typeof a === "string" || typeof b === "string" ? (String(a).toLowerCase() === String(b).toLowerCase() ? 1 : 0) : num(a) === num(b) ? 1 : 0;
      if (n.op === "!=") return typeof a === "string" || typeof b === "string" ? (String(a).toLowerCase() !== String(b).toLowerCase() ? 1 : 0) : num(a) !== num(b) ? 1 : 0;
      const x = num(a), y = num(b);
      switch (n.op) {
        case "+": return x + y;
        case "-": return x - y;
        case "*": return x * y;
        case "/": return y === 0 ? 0 : x / y;
        case "^": return Math.pow(x, y);
        case "<": return x < y ? 1 : 0;
        case "<=": return x <= y ? 1 : 0;
        case ">": return x > y ? 1 : 0;
        case ">=": return x >= y ? 1 : 0;
      }
      throw new Error(`Bad operator ${n.op}`);
    }
  }
}

const truthy = (v: Val) => (typeof v === "string" ? v.trim() !== "" && v.toLowerCase() !== "no" : v !== 0 && !Number.isNaN(v));

/** Names a formula refers to (used to validate ordering / unknown names). */
export function referencedNames(n: Node, acc = new Set<string>()): Set<string> {
  if (n.k === "var") acc.add(n.name);
  else if (n.k === "un") referencedNames(n.a, acc);
  else if (n.k === "bin") { referencedNames(n.a, acc); referencedNames(n.b, acc); }
  else if (n.k === "tern") { referencedNames(n.c, acc); referencedNames(n.a, acc); referencedNames(n.b, acc); }
  else if (n.k === "call") n.args.forEach((x) => referencedNames(x, acc));
  return acc;
}

export const FUNCTION_HELP = [
  ["if(cond, a, b)", "a when cond is true, else b"],
  ["cond ? a : b", "same as if()"],
  ["min(a, b, …) / max(a, b, …)", "smallest / largest"],
  ["round(x, d)", "round to d decimals (default 0)"],
  ["roundup(x, d) / rounddown(x, d)", "like Google Sheets ROUNDUP / ROUNDDOWN"],
  ["contains(text, \"part\")", "1 if text contains part (case-insensitive)"],
  ["and / or / not", "logic; Yes/No flags behave as 1/0"],
  ["12%", "percent literal = 0.12"],
];
