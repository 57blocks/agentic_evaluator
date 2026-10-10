/**
 * `agenteval install-skill` — copy the task-authoring skill into the
 * workspace's `.claude/skills/`, where Claude Code picks it up as
 * `/agenteval-new-task`. The skill interviews the user for a task's inputs,
 * check and references, and proves it with `check-task` before any run.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { findWorkspace, workspaceAt } from "../../core/workspace.js";
import { displayPath, INSTALL_ROOT } from "../../paths.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { rejectUnknown, stringFlag, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";

const SKILL_NAME = "agenteval-new-task";

export const INSTALL_SKILL_HELP = `agenteval install-skill [options]

  Install the /${SKILL_NAME} skill for Claude Code into this workspace
  (.claude/skills/${SKILL_NAME}/). In Claude Code, run /${SKILL_NAME} to
  build a task with an interview: inputs, a check, reference answers,
  candidates, then \`agenteval check-task\` before anything is paid.

  --force             replace an existing copy (yours may have edits)
  --workspace DIR     workspace to install into`;

export async function cmdInstallSkill(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["force", "workspace"]);
  const dir = stringFlag(args.flags, "workspace");
  const ws = dir ? workspaceAt(dir) : await findWorkspace();

  const source = path.join(INSTALL_ROOT, "skills", SKILL_NAME, "SKILL.md");
  const target = path.join(ws.root, ".claude", "skills", SKILL_NAME, "SKILL.md");
  const exists = await fs.stat(target).then(() => true, () => false);
  if (exists && args.flags.force !== true) {
    throw new UsageError(`${displayPath(target)} already exists; --force replaces it`);
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  io.out(`installed ${displayPath(target)}\nIn Claude Code, from ${displayPath(ws.root) || "."}: /${SKILL_NAME}\n`);
  return EXIT.ok;
}
