/**
 * `agenteval dash` — serve the dashboard over this workspace, or with
 * `--export DIR`, write it out as files someone can open without agenteval.
 *
 * Binds to loopback only. The dashboard reads the same run directories the
 * CLI writes; it is a second view of one workspace, never a second copy of
 * the data. An export is the one deliberate copy: frozen, read-only.
 */

import path from "node:path";
import { createDemoServer, listenDemo } from "../../demo/server.js";
import { exportDashboard } from "../../demo/export.js";
import { findWorkspace, workspaceAt } from "../../core/workspace.js";
import { displayPath } from "../../paths.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { numberFlag, rejectUnknown, stringFlag, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";

export const DASH_HELP = `agenteval dash [options]

  Serve the dashboard at http://127.0.0.1:4173 (loopback only).

  --port N            listen on another port
  --workspace DIR     workspace to serve
  --export DIR        write the dashboard to DIR instead of serving it: open
                      DIR/index.html in a browser, no agenteval needed. A
                      read-only copy of every task, run and report as they
                      are now; DIR is replaced.`;

export async function cmdDash(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["port", "workspace", "export"]);
  const dir = stringFlag(args.flags, "workspace");
  const ws = dir ? workspaceAt(dir) : await findWorkspace();

  const exportTo = stringFlag(args.flags, "export");
  if (exportTo) {
    const r = await exportDashboard(ws, path.resolve(exportTo));
    const mb = (r.bytes / 1024 / 1024).toFixed(1);
    io.out(`✔ ${displayPath(path.join(r.outDir, "index.html"))} — ${r.responses} responses (${mb} MB), ${r.reports} report page(s)\n`);
    if (r.skipped.length > 0) io.out(`  Left out as secret-looking: ${r.skipped.join(", ")}\n`);
    if (r.redacted > 0) io.out(`  Replaced ${r.redacted} key-like value(s) with [redacted] in reports, outputs and evidence\n`);
    io.out("  Secret checks catch common key formats, not every secret: look before you send it.\n");
    io.out("  Local paths are replaced: the workspace by its folder name, your home directory by ~.\n");
    io.out(`  Open it in a browser, or zip ${displayPath(r.outDir)} and send it.\n`);
    return EXIT.ok;
  }

  const port = numberFlag(args.flags, "port");
  const server = createDemoServer(ws);
  const url = await listenDemo(server, port);
  io.out(`${url}  —  ${ws.root}  (Ctrl+C to stop)\n`);
  // Resolves when the server closes, so the process stays up.
  await new Promise<void>((resolve) => server.once("close", resolve));
  return EXIT.ok;
}
