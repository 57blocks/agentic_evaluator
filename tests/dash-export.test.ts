/** `agenteval dash --export`: the dashboard written out as files that open from disk, read-only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { exportDashboard } from "../src/demo/export.js";
import { workspaceAt } from "../src/core/workspace.js";

const STATIC_BUILD = path.resolve("dist/demo-static/index.html");
const needsBuild = existsSync(STATIC_BUILD) ? false : "needs the static dashboard build: pnpm build:demo";

type Win = { __AGENTEVAL_SNAPSHOT__?: Record<string, { status: number; body: string }> };
const g = globalThis as unknown as { window?: Win };

test("client: with a snapshot, reads come from it and writes are refused", async () => {
  g.window = { __AGENTEVAL_SNAPSHOT__: { "/api/catalog": { status: 200, body: '{"tasks":[]}' }, "/artifact/run/x/GAPS.md": { status: 200, body: "# gaps" } } };
  try {
    const api = await import("../src/demo/client/lib/api.js");
    assert.deepEqual(await api.getJson("/api/catalog"), { tasks: [] });
    assert.equal(await api.getTextOrNull("/artifact/run/x/GAPS.md"), "# gaps");
    assert.equal(await api.getTextOrNull("/artifact/run/x/missing.md"), null, "a file the export did not record reads as absent");
    await assert.rejects(api.getText("/artifact/task/t/spec.yaml"), /not in this export/);
    await assert.rejects(api.postJson("/api/runs", {}), /read-only export/);
    const { exportedHref } = await import("../src/demo/client/lib/snapshot.js");
    assert.equal(exportedHref("/artifact/run/x/report.html"), "./artifact/run/x/report.html");
  } finally {
    delete g.window;
  }
});

test("export: secret-looking task files are left out, and local paths are scrubbed", { skip: needsBuild }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dash-export-ws-"));
  const task = path.join(root, "tasks", "demo");
  await fs.mkdir(task, { recursive: true });
  await fs.writeFile(
    path.join(task, "spec.yaml"),
    [
      'protocol_version: "0.3"',
      "run_name: demo",
      "workflow:",
      "  steps:",
      "    - id: s",
      '      version: "1"',
      "      test_set: { id: t, inputs: [a] }",
      "      candidate_ids: [m1]",
      "candidates:",
      "  - { id: m1, model: x/y }",
      "evaluators:",
      "  judge: { model: g/j, rubric_file: r.md }",
      "execution: { trials_per_case: 1 }",
      "x-harness: { producer: prompt, prompt_file: p.md }",
      "",
    ].join("\n"),
  );
  await fs.writeFile(path.join(task, "notes.md"), `see ${os.homedir()}/private/thing and ${root}/tasks\n`);
  for (const f of [".env", ".env.local", "deploy.pem", "id_rsa", "aws-credentials.json"]) await fs.writeFile(path.join(task, f), "SECRET=1\n");
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "dash-export-"));

  const r = await exportDashboard(workspaceAt(root), out);

  const data = (await Promise.all((await fs.readdir(path.join(out, "data"))).map((f) => fs.readFile(path.join(out, "data", f), "utf-8")))).join("");
  assert.doesNotMatch(data, /SECRET=1/, "no secret file's content");
  assert.deepEqual(r.skipped.sort(), ["demo/.env", "demo/.env.local", "demo/aws-credentials.json", "demo/deploy.pem", "demo/id_rsa"]);
  assert.ok(!data.includes(os.homedir()), "no home directory path");
  assert.ok(!data.includes(root), "no absolute workspace path");
  assert.match(data, /see ~\/private\/thing/);
});

test("redaction: common key formats are replaced, ordinary text is not", async () => {
  const { redactSecrets } = await import("../src/demo/export.js");
  const keys = [
    "sk-or-v1-0123456789abcdef0123456789abcdef",
    "sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345",
    "AKIAIOSFODNN7EXAMPLE",
    "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
    "xoxb-1234567890-abcdefghij",
    "-----BEGIN RSA PRIVATE KEY-----",
  ];
  for (const k of keys) {
    const { text, count } = redactSecrets(`before ${k} after`);
    assert.equal(count, 1, k);
    assert.equal(text, "before [redacted] after", k);
  }
  const assigned = redactSecrets('OPENROUTER_API_KEY="abcdEFGH1234ijklMNOP5678"');
  assert.equal(assigned.count, 1);
  assert.doesNotMatch(assigned.text, /abcdEFGH1234/);
  const dotenv = redactSecrets("OPENAI_API_KEY=abcdEFGH1234ijklMNOP5678\nOTHER=1");
  assert.equal(dotenv.count, 1);
  assert.equal(dotenv.text, "OPENAI_API_KEY=[redacted]\nOTHER=1");
  for (const plain of [
    "The redetermination deadline is 125 days after the notice; see token budget in RULES.md.",
    "env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN }",
    "settlementToken: paymentTokenEnum,",
    'const token = document.getElementById("csrf");',
    '"password": "correct horse battery staple"',
  ]) {
    assert.deepEqual(redactSecrets(plain), { text: plain, count: 0 }, plain);
  }
});

test("export: a task file whose content holds a key is left out, whatever its name", { skip: needsBuild }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dash-export-ws-"));
  const task = path.join(root, "tasks", "demo");
  await fs.mkdir(task, { recursive: true });
  await fs.cp(path.resolve("datasets/tasks/kyc-ubo-v2/spec.yaml"), path.join(task, "spec.yaml"));
  await fs.writeFile(path.join(task, "config.json"), '{"apiKey": "sk-or-v1-0123456789abcdef0123456789abcdef"}\n');
  await fs.writeFile(path.join(task, "notes.md"), "nothing secret here\n");
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "dash-export-"));

  const r = await exportDashboard(workspaceAt(root), out);

  const data = (await Promise.all((await fs.readdir(path.join(out, "data"))).map((f) => fs.readFile(path.join(out, "data", f), "utf-8")))).join("");
  assert.ok(r.skipped.includes("demo/config.json"), r.skipped.join(", "));
  assert.doesNotMatch(data, /sk-or-v1-0123456789/);
  assert.match(data, /nothing secret here/);
});

test("export: index.html carries the app inline, data scripts hold every page's reads, report pages sit beside it", { skip: needsBuild }, async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "dash-export-"));
  const r = await exportDashboard(workspaceAt(path.resolve("datasets")), out);

  const html = await fs.readFile(path.join(out, "index.html"), "utf-8");
  assert.doesNotMatch(html, /<script type="module"[^>]*src=/, "no module script loaded from a file: it would not run from disk");
  assert.doesNotMatch(html, /<link rel="stylesheet"/, "styles are inline");
  assert.match(html, /<script src="data\/snapshot-1\.js"><\/script>/);

  const data = (await fs.readdir(path.join(out, "data"))).sort();
  // Run the data scripts as the page would, in a sandbox with only a `window`.
  const sandbox = vm.createContext({ window: {} as { __AGENTEVAL_SNAPSHOT__?: Record<string, { status: number; body: string }> } });
  for (const f of data) vm.runInContext(await fs.readFile(path.join(out, "data", f), "utf-8"), sandbox);
  const snapshot = (sandbox.window as { __AGENTEVAL_SNAPSHOT__: Record<string, { status: number; body: string }> }).__AGENTEVAL_SNAPSHOT__;

  assert.equal(Object.keys(snapshot).length, r.responses);
  assert.equal(snapshot["/api/catalog"].status, 200);
  const catalog = JSON.parse(snapshot["/api/catalog"].body) as { tasks: Array<{ name: string; runs: Array<{ dir: string }> }> };
  const claim = catalog.tasks.find((t) => t.name === "claim-denials-snf-v2")!;
  const runDir = claim.runs[0].dir;
  assert.equal(snapshot[`/api/report/${runDir.split("/").map(encodeURIComponent).join("/")}`].status, 200, "the run's report model");
  assert.equal(snapshot[`/artifact/${runDir}/scores.jsonl`].status, 200, "the run's evidence");
  assert.ok(Object.keys(snapshot).some((u) => u.startsWith("/artifact/task/claim-denials-snf-v2/")), "the task's definition files");
  assert.ok(existsSync(path.join(out, "artifact", runDir, "report.html")), "the run's own report.html, linked from its page");
});
