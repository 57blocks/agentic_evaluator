/**
 * Running a candidate's command inside a container.
 *
 * Without this an agent-cli candidate runs as this process: this user, this
 * filesystem, this network, this shell history. The candidate is an agent
 * whose whole job is to write and execute code it just invented, and the
 * harness hands it the machine that grades it. A container is the smallest
 * honest answer — the work dir is the only thing it can see, the network is
 * off unless the spec asks for it, and the secrets it gets are the ones the
 * spec names.
 *
 * Isolation is per candidate (`cli.image`) rather than global because the
 * command is the candidate: `claude -p` needs an image with that CLI in it,
 * while a task-local `node agents/run.mjs` only needs node — the directory
 * the script lives in is mounted read-only under `/task`. A candidate with
 * no image still runs, on the host, and every trial records which of the two
 * happened.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import type { AgentCliConfig } from "../canon/types.js";
import { AdapterError } from "./types.js";

const MAX_BUFFER = 2 * 1024 * 1024;

/** Where the work dir is mounted inside the container. */
export const CONTAINER_WORKDIR = "/work";

/** Where a task directory the command declared (e.g. `agents/`) is mounted, read-only. */
export const TASK_MOUNT = "/task";

/** A host path the container can read but not write. */
export interface Mount {
  host: string;
  container: string;
}

export interface RunOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Environment for the container: only the keys the spec names.
 *
 * An empty value means "pass the host's value through", so a spec can hand
 * over `ANTHROPIC_API_KEY` without writing the key into a file that gets
 * committed. A named key the host does not have is dropped rather than
 * passed as an empty string, which an SDK would read as "configured".
 */
export function containerEnv(declared: Record<string, string> | undefined): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(declared ?? {})) {
    const resolved = value === "" ? process.env[key] : value;
    if (resolved === undefined) continue;
    args.push("-e", `${key}=${resolved}`);
  }
  return args;
}

/** `docker run` arguments, exported so a test can assert the flags. */
export function dockerArgs(
  cli: AgentCliConfig,
  name: string,
  workDir: string,
  argv: readonly string[],
  mounts: readonly Mount[] = [],
): string[] {
  return [
    "run",
    "--rm",
    "--name", name,
    // Files the candidate writes must stay readable by the harness that
    // collects them; without this they come back owned by root.
    ...(process.platform === "linux" ? ["--user", `${os.userInfo().uid}:${os.userInfo().gid}`] : []),
    "--network", cli.network ?? "none",
    "--memory", cli.memory ?? "2g",
    "--cpus", cli.cpus ?? "2",
    // A fork bomb in generated code should not take the host down with it.
    "--pids-limit", "512",
    "-v", `${workDir}:${CONTAINER_WORKDIR}`,
    // The task's own code, read-only and outside the work dir, so it can be
    // run but neither changed nor collected as part of the deliverable.
    ...mounts.flatMap((m) => ["-v", `${m.host}:${m.container}:ro`]),
    "-w", CONTAINER_WORKDIR,
    ...containerEnv(cli.env),
    cli.image!,
    ...argv,
  ];
}

/** True when a usable docker daemon is reachable. */
export function dockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 10_000 }, (err) =>
      resolve(!err),
    );
  });
}

/**
 * Run `argv` in `cli.image` with `workDir` mounted.
 *
 * A timeout kills the container as well as the client: `execFile`'s own
 * timeout only kills the `docker run` process, leaving the candidate running
 * — and still holding the work dir the next trial is about to use.
 */
export function runInDocker(
  cli: AgentCliConfig,
  argv: readonly string[],
  opts: { workDir: string; timeoutMs: number; mounts?: readonly Mount[] },
): Promise<RunOutcome> {
  const name = `ae-trial-${randomUUID().slice(0, 12)}`;
  const args = dockerArgs(cli, name, opts.workDir, argv, opts.mounts);

  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    execFile(
      "docker",
      args,
      { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        const ms = Date.now() - t0;
        const out = { stdout: stdout ?? "", stderr: stderr ?? "" };
        if (!error) {
          resolve({ ...out, exitCode: 0 });
          return;
        }
        const e = error as NodeJS.ErrnoException & { killed?: boolean; code?: unknown };
        if (e.killed) {
          execFile("docker", ["kill", name], () => {
            reject(new AdapterError("candidate container timed out", { kind: "timeout", ms }));
          });
          return;
        }
        if (e.code === "ENOENT") {
          reject(new AdapterError("docker not found on PATH", { kind: "spawn", ms }));
          return;
        }
        // 125 is docker itself failing (no such image, bad flag) — an
        // adapter fault. Anything else is the candidate's own exit code.
        if (typeof e.code === "number" && e.code !== 125) {
          resolve({ ...out, exitCode: e.code });
          return;
        }
        reject(
          new AdapterError(`docker run failed: ${out.stderr.trim() || e.message}`, {
            kind: "spawn",
            ms,
          }),
        );
      },
    );
  });
}
