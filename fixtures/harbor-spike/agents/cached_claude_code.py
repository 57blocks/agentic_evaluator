"""Harbor's claude-code agent, installed from a binary cached on the host.

Harbor's own install downloads ~290 MB from downloads.claude.ai inside every
container, and first installs nodejs/npm for its npm fallback. On a slow
link either step outlasts the setup timeout. This subclass uploads a binary
downloaded once on the host (the native binary needs no node) and changes
nothing else: the run, the trajectory conversion and Harbor's cost
accounting are the stock agent's.

harbor-run.sh selects it when HARBOR_CLAUDE_CODE_BINARY is set:

  harbor run ... -a cached_claude_code:CachedClaudeCode
    with PYTHONPATH=<this dir> and CLAUDE_CODE_BINARY=<linux binary>

The binary for the task image's architecture (amd64 for terminal-bench):
  curl -fSLO https://downloads.claude.ai/claude-code-releases/<version>/linux-x64/claude
with <version> from https://downloads.claude.ai/claude-code-releases/latest.
"""

import os
from pathlib import Path

from harbor.agents.installed.claude_code import ClaudeCode
from harbor.environments.base import BaseEnvironment

BINARY_ENV = "CLAUDE_CODE_BINARY"
TARGET = "/usr/local/bin/claude"


class CachedClaudeCode(ClaudeCode):
    async def install(self, environment: BaseEnvironment) -> None:
        if await self._installed_claude_satisfies_version(environment):
            return
        source = os.environ.get(BINARY_ENV)
        if not source or not Path(source).is_file():
            raise RuntimeError(f"{BINARY_ENV} must point at a Claude Code linux binary; got {source!r}")
        await self.ensure_system_dependencies(environment, ("curl", "bash", "procps"))
        await environment.upload_file(source, TARGET)
        result = await environment.exec(command=f"chmod 755 {TARGET} && {TARGET} --version", user="root")
        if result.return_code != 0:
            raise RuntimeError(f"uploaded claude does not run: rc={result.return_code} stderr={result.stderr!r}")
        self.logger.info(f"Claude Code installed from host cache: {(result.stdout or '').strip()}")
