/**
 * Where a command writes.
 *
 * Injected rather than reached for, so a test can read what a command said
 * without monkey-patching the process's streams — which, when the test runner
 * is also writing to them, captures its output too and interleaves the two.
 */

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

export const processIo: Io = {
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
};

/** Collects everything written, for tests. */
export function bufferIo(): Io & { readonly stdout: string; readonly stderr: string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
    get stdout() {
      return out.join("");
    },
    get stderr() {
      return err.join("");
    },
  };
}
