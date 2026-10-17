// Parser for Paradox (Clausewitz/Jomini) script files.
// Keeps duplicate keys in order, since CoA files rely on repeated `instance`/`colored_emblem` entries.

export type PdxScalar = string | number;

export interface PdxBlock {
  kind: 'block';
  /** `key = value` entries, in file order. */
  entries: PdxEntry[];
  /** Bare values such as the numbers in `{ 0.5 0.5 }`, in file order. */
  values: PdxValue[];
}

/** A tagged block such as `rgb { 1 2 3 }` or `hsv360 { 0 50 50 }`. */
export interface PdxTagged {
  kind: 'tagged';
  tag: string;
  block: PdxBlock;
}

export type PdxValue = PdxScalar | PdxBlock | PdxTagged;

export interface PdxEntry {
  key: string;
  op: string;
  value: PdxValue;
}

export class PdxParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(`${message} (line ${line})`);
  }
}

type TokenType = 'word' | 'string' | 'op' | 'open' | 'close' | 'math';
interface Token {
  type: TokenType;
  text: string;
  line: number;
}

const OPS = ['?=', '!=', '<=', '>=', '==', '=', '<', '>'];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === '\n') {
      line++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i++;
    } else if (c === '#') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '{') {
      tokens.push({ type: 'open', text: c, line });
      i++;
    } else if (c === '}') {
      tokens.push({ type: 'close', text: c, line });
      i++;
    } else if (c === '"') {
      let j = i + 1;
      let text = '';
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < n) {
          text += src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === '\n') line++;
        text += src[j];
        j++;
      }
      tokens.push({ type: 'string', text, line });
      i = j + 1;
    } else if (c === '@' && src[i + 1] === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) throw new PdxParseError('Unterminated @[ expression', line);
      tokens.push({ type: 'math', text: src.slice(i + 2, end), line });
      i = end + 1;
    } else {
      const op = OPS.find((o) => src.startsWith(o, i));
      if (op) {
        tokens.push({ type: 'op', text: op, line });
        i += op.length;
        continue;
      }
      let j = i;
      while (j < n && !/[\s{}=<>!?#"]/.test(src[j]!)) j++;
      if (j === i) throw new PdxParseError(`Unexpected character '${c}'`, line);
      tokens.push({ type: 'word', text: src.slice(i, j), line });
      i = j;
    }
  }
  return tokens;
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export interface ParseOptions {
  /** Resolve `@name` variables and `@[ … ]` expressions while parsing (default true). */
  resolveVariables?: boolean;
}

/** Parse a whole file into a root block. */
export function parsePdx(src: string, options: ParseOptions = {}): PdxBlock {
  const resolve = options.resolveVariables ?? true;
  const tokens = tokenize(src);
  const vars = new Map<string, PdxValue>();
  let pos = 0;

  const peek = (o = 0) => tokens[pos + o];

  function scalar(tok: Token): PdxValue {
    if (tok.type === 'string') return tok.text;
    if (tok.type === 'math') return resolve ? evalMath(tok.text, vars, tok.line) : `@[${tok.text}]`;
    if (resolve && tok.text.startsWith('@')) {
      const v = vars.get(tok.text.slice(1));
      if (v === undefined) throw new PdxParseError(`Unknown variable ${tok.text}`, tok.line);
      return v;
    }
    return NUMBER_RE.test(tok.text) ? Number(tok.text) : tok.text;
  }

  function parseValue(): PdxValue {
    const tok = tokens[pos++];
    if (!tok) throw new PdxParseError('Unexpected end of file', tokens.at(-1)?.line ?? 0);
    if (tok.type === 'open') return parseBlock(tok.line);
    if (tok.type === 'word' && peek()?.type === 'open') {
      pos++;
      return { kind: 'tagged', tag: tok.text, block: parseBlock(tok.line) };
    }
    if (tok.type === 'word' || tok.type === 'string' || tok.type === 'math') return scalar(tok);
    throw new PdxParseError(`Unexpected '${tok.text}'`, tok.line);
  }

  function parseBlock(openLine: number, isRoot = false): PdxBlock {
    const block: PdxBlock = { kind: 'block', entries: [], values: [] };
    for (;;) {
      const tok = peek();
      if (!tok) {
        if (isRoot) return block;
        throw new PdxParseError('Unclosed block', openLine);
      }
      if (tok.type === 'close') {
        pos++;
        if (isRoot) continue; // tolerate stray closing braces, as the game does
        return block;
      }
      const next = peek(1);
      if ((tok.type === 'word' || tok.type === 'string') && next?.type === 'op') {
        pos += 2;
        const value = parseValue();
        // Variables may be declared at any depth; later declarations win.
        if (resolve && tok.text.startsWith('@')) {
          vars.set(tok.text.slice(1), value);
          continue;
        }
        block.entries.push({ key: tok.text, op: next.text, value });
      } else {
        block.values.push(parseValue());
      }
    }
  }

  return parseBlock(1, true);
}

/** Evaluate an `@[ … ]` expression: numbers, variable names, + - * / and parentheses. */
function evalMath(expr: string, vars: Map<string, PdxValue>, line: number): number {
  const toks = expr.match(/\d+\.?\d*|\.\d+|[A-Za-z_][A-Za-z0-9_]*|[-+*/()]/g) ?? [];
  let i = 0;
  const atom = (): number => {
    const t = toks[i++];
    if (t === undefined) throw new PdxParseError(`Bad expression @[${expr}]`, line);
    if (t === '(') {
      const v = sum();
      i++;
      return v;
    }
    if (t === '-') return -atom();
    if (/^[\d.]/.test(t)) return Number(t);
    const v = vars.get(t);
    if (typeof v !== 'number') throw new PdxParseError(`Unknown numeric variable ${t}`, line);
    return v;
  };
  const product = (): number => {
    let v = atom();
    while (toks[i] === '*' || toks[i] === '/') v = toks[i++] === '*' ? v * atom() : v / atom();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (toks[i] === '+' || toks[i] === '-') v = toks[i++] === '+' ? v + product() : v - product();
    return v;
  };
  return sum();
}

// --- Helpers for reading parsed blocks ---

export function isBlock(v: PdxValue | undefined): v is PdxBlock {
  return typeof v === 'object' && v.kind === 'block';
}

export function getAll(block: PdxBlock, key: string): PdxValue[] {
  return block.entries.filter((e) => e.key === key).map((e) => e.value);
}

export function getFirst(block: PdxBlock, key: string): PdxValue | undefined {
  return block.entries.find((e) => e.key === key)?.value;
}

export function getNumbers(v: PdxValue | undefined): number[] {
  if (!isBlock(v)) return [];
  return v.values.filter((x): x is number => typeof x === 'number');
}
