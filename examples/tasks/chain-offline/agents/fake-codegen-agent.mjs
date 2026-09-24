#!/usr/bin/env node
/**
 * Local stand-in for a codegen agent. Writes utils.ts into cwd so the
 * tsc required check can run. --mode fail emits a type error on purpose.
 */
import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2] === "--mode" ? (process.argv[3] ?? "ok") : "ok";

const pass = `export function parseQueryString(qs: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const s = qs.startsWith("?") ? qs.slice(1) : qs;
  if (s === "") return out;
  const decode = (raw: string): string => {
    const plus = raw.replace(/\\+/g, " ");
    try {
      return decodeURIComponent(plus);
    } catch {
      return raw;
    }
  };
  for (const part of s.split("&")) {
    if (part === "") continue;
    const eq = part.indexOf("=");
    const key = decode(eq === -1 ? part : part.slice(0, eq));
    const val = eq === -1 ? "" : decode(part.slice(eq + 1));
    const prev = out[key];
    if (prev === undefined) out[key] = val;
    else if (Array.isArray(prev)) prev.push(val);
    else out[key] = [prev, val];
  }
  return out;
}
`;

const fail = `export function parseQueryString(qs: string): Record<string, string | string[]> {
  return 1;
}
`;

fs.writeFileSync(path.join(process.cwd(), "utils.ts"), mode === "fail" ? fail : pass, "utf8");
console.log(mode === "fail" ? "wrote broken utils.ts" : "wrote utils.ts");
