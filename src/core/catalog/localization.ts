// Parser for Paradox localisation files (`key:0 "Text"`).

const LINE_RE = /^\s*([A-Za-z0-9_.\-']+):\d*\s*"(.*)"\s*(#.*)?$/;

export function parseLocalization(src: string, into = new Map<string, string>()): Map<string, string> {
  for (const raw of src.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = LINE_RE.exec(raw);
    if (!m) continue;
    // Some values contain unescaped quotes; the regex is greedy up to the last quote.
    into.set(m[1]!, m[2]!);
  }
  return into;
}
