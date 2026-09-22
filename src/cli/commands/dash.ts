/**
 * `agenteval dash` — serve the dashboard over this workspace.
 *
 * Binds to loopback only. The dashboard reads the same run directories the
 * CLI writes; it is a second view of one workspace, never a second copy of
 * the data.
 */

import { createDemoServer, listenDemo } from "../../demo/server.js";
import { findWorkspace, workspaceAt } from "../../core/workspace.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { numberFlag, rejectUnknown, stringFlag, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";

export const DASH_HELP = `agenteval dash [options]

  Serve the dashboard at http://127.0.0.1:4173 (loopback only).

  --port N            listen on another port
  --workspace DIR     workspace to serve`;

export async function cmdDash(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["port", "workspace"]);
  const dir = stringFlag(args.flags, "workspace");
  const ws = dir ? workspaceAt(dir) : await findWorkspace();
  const port = numberFlag(args.flags, "port");

  const server = createDemoServer(ws);
  const url = await listenDemo(server, port);
  io.out(`${url}  —  ${ws.root}  (Ctrl+C to stop)\n`);
  // Resolves when the server closes, so the process stays up.
  await new Promise<void>((resolve) => server.once("close", resolve));
  return EXIT.ok;
}
