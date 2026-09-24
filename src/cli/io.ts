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

/** Streams whose reader went away; writing to them again only raises another EPIPE. */
const closedStreams = new WeakSet<NodeJS.WriteStream>();

function writeUnlessClosed(stream: NodeJS.WriteStream, text: string): void {
  if (!closedStreams.has(stream)) stream.write(text);
}

export const processIo: Io = {
  out: (text) => writeUnlessClosed(process.stdout, text),
  err: (text) => writeUnlessClosed(process.stderr, text),
};

/**
 * `agenteval run … | head` closes stdout while the run is still going. Node
 * reports that as an unhandled EPIPE and kills the process, which takes a
 * half-written run directory with it. A reader leaving is not a reason to stop
 * collecting evidence: stop writing to that stream and let the run finish.
 * Any other stream error is still fatal.
 */
export function tolerateClosedPipes(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EPIPE") throw err;
      closedStreams.add(stream);
    });
  }
}

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
