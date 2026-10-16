/**
 * Run a candidate or check command as a process tree we can stop.
 *
 * `execFile` falls short twice for agents that run for hours
 * (docs/design/agb-flow-gaps.md A7, A8):
 *
 *   - Its timeout kills the command, not what the command started. An agent
 *     wrapper's own children (claude sessions, a dev server) kept running,
 *     and billing. Here every command leads its own process group, and a
 *     timeout signals the whole group: SIGTERM, then SIGKILL after a grace.
 *   - Past `maxBuffer` it kills the command. Output is evidence, not the
 *     deliverable: here only the tail is kept and the command runs on.
 *
 * A command in its own group no longer gets the terminal's Ctrl+C, so live
 * groups are tracked and killed when this process is interrupted or exits.
 */

import { spawn } from "node:child_process";

const KILL_GRACE_MS = 5_000;
/** Output kept per stream: the last 2 MB, as `maxBuffer` allowed before. */
export const DEFAULT_OUTPUT_TAIL_BYTES = 2 * 1024 * 1024;

export interface ProcessResult {
  stdout: string;
  stderr: string;
  /** Exit code; null when a signal ended it. */
  exitCode: number | null;
  timedOut: boolean;
  /** Bytes dropped from the front of stdout + stderr to keep the tail. */
  droppedBytes: number;
  ms: number;
}

export class SpawnError extends Error {
  constructor(message: string, readonly code: string | undefined, readonly ms: number) {
    super(message);
  }
}

const live = new Set<number>();
let hooked = false;

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

/** Kill every live group once, when this process is interrupted or ends. */
function hookExit(): void {
  if (hooked) return;
  hooked = true;
  const killAll = (): void => {
    for (const pid of live) killGroup(pid, "SIGKILL");
    live.clear();
  };
  process.once("exit", killAll);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      killAll();
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
}

/** Keeps the last `limit` bytes written to it. */
class Tail {
  private chunks: Buffer[] = [];
  private size = 0;
  dropped = 0;
  constructor(private readonly limit: number) {}
  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.limit && this.chunks.length > 0) {
      const over = this.size - this.limit;
      const first = this.chunks[0]!;
      if (first.length <= over) {
        this.chunks.shift();
        this.size -= first.length;
        this.dropped += first.length;
      } else {
        this.chunks[0] = first.subarray(over);
        this.size -= over;
        this.dropped += over;
      }
    }
  }
  text(): string {
    return Buffer.concat(this.chunks).toString("utf-8");
  }
}

export function runProcess(
  cmd: string,
  args: readonly string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number; tailBytes?: number },
): Promise<ProcessResult> {
  hookExit();
  const t0 = Date.now();
  const limit = opts.tailBytes ?? DEFAULT_OUTPUT_TAIL_BYTES;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const out = new Tail(limit);
    const err = new Tail(limit);
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    if (child.pid !== undefined) live.add(child.pid);

    let timedOut = false;
    let hardKill: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid === undefined) return;
      killGroup(child.pid, "SIGTERM");
      hardKill = setTimeout(() => killGroup(child.pid!, "SIGKILL"), KILL_GRACE_MS);
    }, opts.timeoutMs);

    const settle = (): void => {
      clearTimeout(timer);
      if (hardKill) clearTimeout(hardKill);
      if (child.pid !== undefined) live.delete(child.pid);
    };
    child.on("error", (e: NodeJS.ErrnoException) => {
      settle();
      reject(new SpawnError(e.message, e.code, Date.now() - t0));
    });
    // The leader is gone: anything it left in its group (a server, a session
    // still holding the pipes) goes too, or "close" would wait on it.
    child.on("exit", () => {
      if (child.pid !== undefined) killGroup(child.pid, "SIGKILL");
    });
    child.on("close", (code) => {
      settle();
      resolve({
        stdout: out.text(),
        stderr: err.text(),
        exitCode: code,
        timedOut,
        droppedBytes: out.dropped + err.dropped,
        ms: Date.now() - t0,
      });
    });
  });
}

/**
 * Stop every process whose command line names `dir`: what an agent started
 * and detached from its process group (a `tsx watch` dev server, `nohup
 * npm run dev &`) survives the group kill and runs on after the trial,
 * holding ports and memory. Matched on the dir's real path too, since macOS
 * temp dirs show as /private/var/... in a process table.
 */
export async function killProcessesUnder(dir: string): Promise<number> {
  const { realpath } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const paths = [...new Set([dir, await realpath(dir).catch(() => dir)])];
  let killed = 0;
  for (const p of paths) {
    const pids = await new Promise<number[]>((resolve) =>
      execFile("pgrep", ["-f", p], (err, out) =>
        resolve(err ? [] : String(out).split("\n").map(Number).filter((n) => n > 0 && n !== process.pid)),
      ),
    );
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
        killed += 1;
      } catch {
        // Gone already.
      }
    }
  }
  return killed;
}
