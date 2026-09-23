import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { containerEnv, dockerArgs, dockerAvailable, CONTAINER_WORKDIR } from "../src/adapters/docker.js";
import { agentCliAdapter } from "../src/adapters/agent-cli.js";
import type { AgentCliConfig } from "../src/canon/types.js";

const BASE: AgentCliConfig = { argv: ["true"], image: "alpine:3" };

test("the container gets the work dir, a locked-down network and resource ceilings", () => {
  const args = dockerArgs(BASE, "ae-test", "/tmp/work", ["sh", "-c", "echo hi"]);
  const joined = args.join(" ");

  assert.match(joined, /--rm/);
  assert.match(joined, new RegExp(`-v /tmp/work:${CONTAINER_WORKDIR}`));
  assert.match(joined, new RegExp(`-w ${CONTAINER_WORKDIR}`));
  // Off unless the spec asks: an agent that needs no network should not have one.
  assert.match(joined, /--network none/);
  assert.match(joined, /--memory 2g/);
  assert.match(joined, /--pids-limit 512/);
  // The command comes after the image, never before it.
  assert.ok(args.indexOf("alpine:3") < args.indexOf("sh"));
});

test("a spec that wants network access says so", () => {
  const args = dockerArgs({ ...BASE, network: "bridge" }, "n", "/w", ["true"]);
  assert.match(args.join(" "), /--network bridge/);
});

test("only the env keys a spec names cross into the container", () => {
  process.env.AE_ISOLATION_FIXTURE = "from-host";
  try {
    const args = containerEnv({ AE_ISOLATION_FIXTURE: "", LITERAL: "value", ABSENT_ON_HOST: "" });

    // An empty value means "pass the host's through" — the spec still had to
    // name the key, so every secret the candidate sees is written down.
    assert.ok(args.includes("AE_ISOLATION_FIXTURE=from-host"));
    assert.ok(args.includes("LITERAL=value"));
    // A named key the host lacks is dropped, not passed as "": an SDK reads
    // an empty string as configured and fails later, further from the cause.
    assert.ok(!args.some((a) => a.startsWith("ABSENT_ON_HOST")));
  } finally {
    delete process.env.AE_ISOLATION_FIXTURE;
  }
});

test("a containerised candidate cannot read the host filesystem", { timeout: 180_000 }, async (t) => {
  if (!(await dockerAvailable())) return t.skip("docker not available");

  const probe = ["sh", "-c", `ls ${process.cwd()} 2>&1 | head -1`];
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ae-iso-"));

  const contained = await agentCliAdapter.execute(
    {
      stepId: "s", candidateId: "c", inputId: "i", inputText: "x",
      promptTemplate: "", temperature: 0, timeoutMs: 120_000,
      cli: { argv: probe, image: "alpine:3", network: "none" },
    },
    { workDir },
  );

  assert.equal(contained.isolation, "docker");
  assert.match(contained.text, /No such file or directory/);

  // The same probe without an image: it reads the repo, and the result says
  // so rather than leaving a reader to assume it was sandboxed.
  const host = await agentCliAdapter.execute(
    {
      stepId: "s", candidateId: "c", inputId: "i", inputText: "x",
      promptTemplate: "", temperature: 0, timeoutMs: 120_000,
      cli: { argv: probe },
    },
    { workDir: await fs.mkdtemp(path.join(os.tmpdir(), "ae-host-")) },
  );

  assert.equal(host.isolation, "none");
  assert.doesNotMatch(host.text, /No such file or directory/);
});
