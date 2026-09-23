/**
 * Argument parsing: small, explicit, and no dependency.
 *
 * Flags are `--name` or `--name value`; everything else is positional. An
 * unknown flag is an error rather than a silent no-op — a typo'd `--yes` that
 * quietly previews instead of running is the kind of thing you only notice
 * when the bill does not arrive.
 */

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | true>;
}

export class UsageError extends Error {}

export function parseArgs(argv: readonly string[], spec: { valued?: readonly string[] } = {}): ParsedArgs {
  const valued = new Set(spec.valued ?? []);
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (eq !== -1) {
      flags[name] = arg.slice(eq + 1);
      continue;
    }
    if (valued.has(name)) {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`--${name} needs a value`);
      flags[name] = value;
      continue;
    }
    flags[name] = true;
  }
  return { positional, flags };
}

/** Reject anything the command does not define, naming what it does. */
export function rejectUnknown(flags: Record<string, string | true>, known: readonly string[]): void {
  const unknown = Object.keys(flags).filter((f) => !known.includes(f));
  if (unknown.length > 0) {
    throw new UsageError(`unknown flag${unknown.length > 1 ? "s" : ""} --${unknown.join(", --")} (known: ${known.map((k) => `--${k}`).join(", ")})`);
  }
}

export function numberFlag(flags: Record<string, string | true>, name: string): number | undefined {
  const raw = flags[name];
  if (raw === undefined) return undefined;
  if (raw === true) throw new UsageError(`--${name} needs a number`);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number, got "${raw}"`);
  return n;
}

export function stringFlag(flags: Record<string, string | true>, name: string): string | undefined {
  const raw = flags[name];
  if (raw === undefined) return undefined;
  if (raw === true) throw new UsageError(`--${name} needs a value`);
  return raw;
}
