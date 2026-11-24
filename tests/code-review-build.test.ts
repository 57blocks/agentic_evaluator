/**
 * `code-review build` (and the PR-range resolver it shares with pick-clean)
 * on the synthetic shop repo: items in the contract's shape, line numbers in
 * the PR head, fixtures that end at the PR head and are byte-identical
 * however the source clone is packed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build, writeBuild, type Item } from "../src/code-review/build.js";
import { readMined } from "../src/code-review/candidates-file.js";
import { writeBundle } from "../src/code-review/fixture-bundle.js";
import { resolvePin } from "../src/code-review/pin.js";
import { locateDefect } from "../src/code-review/locate.js";
import { DEFAULT_BLAME, mine } from "../src/code-review/mine.js";
import { resolveRange, type PrRange } from "../src/code-review/pr-range.js";
import type { MinedFile } from "../src/code-review/types.js";
import { readItems } from "../src/core/items.js";
import { EXIT } from "../src/cli/exit-codes.js";
import { bufferIo } from "../src/cli/io.js";
import { main } from "../src/cli/index.js";
import { UsageError } from "../src/cli/args.js";
import { buildShopRepo, CALC, ISOLATED_GIT_ENV, TestRepo, type ShopRepo } from "./helpers/code-review-repo.js";

let shopPromise: Promise<ShopRepo> | undefined;
const shop = (): Promise<ShopRepo> => (shopPromise ??= buildShopRepo());

const sh = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd, encoding: "utf-8", env: { ...process.env, ...ISOLATED_GIT_ENV } });

async function minedShop(s: ShopRepo, edit: (m: MinedFile) => MinedFile = (m) => m): Promise<MinedFile> {
  const mined = await mine({
    repo: s.repo.dir, branch: "main", head: s.sha.c17, since: "2025-01-01", until: null, fixPattern: "^corrige",
    maxRemovedLines: 40, minOwnerShare: 0.6, blame: DEFAULT_BLAME, github: s.github,
  });
  return edit(mined);
}

const confirmAll = (m: MinedFile): MinedFile => ({
  ...m,
  candidates: m.candidates.map((c) => ({
    ...c,
    confirmed: true,
    ...(c.introducing.unit.kind === "pr" && c.introducing.unit.number === 1 ? { label: { category: "calculation", severity: "high", description: "The discount adds the rate instead of subtracting it." } } : {}),
  })),
});

const tmp = (prefix: string): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), prefix));

async function filesUnder(dir: string): Promise<Record<string, Buffer>> {
  const out: Record<string, Buffer> = {};
  for (const e of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) out[path.relative(dir, path.join(e.parentPath, e.name))] = await fs.readFile(path.join(e.parentPath, e.name));
  }
  return out;
}

test("the range resolver tells rebase, squash, merge-commit and single-commit units apart", async () => {
  // Arrange
  const s = await shop();
  const r = async (unit: Parameters<typeof resolveRange>[1]): Promise<PrRange> => {
    const got = await resolveRange(s.repo.dir, unit, s.github);
    assert.ok("range" in got, JSON.stringify(got));
    return got.range;
  };
  const pr = (number: number) => ({ kind: "pr" as const, number, title: "", merged_at: null });

  // Act + Assert
  assert.deepEqual(await r(pr(1)), { kind: "rebase", base: s.sha.c0, replay: [s.sha.c1, s.sha.c2], members: [s.sha.c1, s.sha.c2], head: s.sha.c2 });
  assert.deepEqual(await r(pr(2)), { kind: "squash", base: s.sha.c2, replay: [s.sha.c3], members: [s.sha.c3], head: s.sha.c3 });
  assert.deepEqual(await r(pr(3)), { kind: "merge", base: s.sha.c3, replay: [s.sha.c4, s.sha.c5], members: [s.sha.c4, s.sha.c5], head: s.sha.c5 });
  assert.deepEqual(await r({ kind: "commit", sha: s.sha.c16, title: "" }), { kind: "commit", base: s.sha.c15, replay: [s.sha.c16], members: [s.sha.c16], head: s.sha.c16 });
});

test("a PR GitHub truncates, or one with no GitHub to ask, is skipped with a reason", async () => {
  const s = await shop();
  const truncated = { ...s.github, pull: async (n: number) => ({ ...(await s.github.pull(n)), commitCount: 312 }) };
  const got = await resolveRange(s.repo.dir, { kind: "pr", number: 1, title: "", merged_at: null }, truncated);
  assert.deepEqual(got, { skip: "PR #1 has 312 commits and GitHub lists only 2: its base is unknown" });
  const none = await resolveRange(s.repo.dir, { kind: "pr", number: 1, title: "", merged_at: null }, null);
  assert.ok("skip" in none && /needs GitHub/.test(none.skip));
});

test("build writes one item per PR in the contract's shape, with the defect at its PR-head lines", async () => {
  // Arrange
  const s = await shop();
  const task = await tmp("cr-task-");

  // Act
  const { items, report } = await build({ repo: s.repo.dir, mined: await minedShop(s, confirmAll), clean: null, taskDir: task, github: s.github, includeUnconfirmed: false });
  await writeBuild(task, items, report);

  // Assert
  assert.deepEqual(items.map((i) => i.id), ["pr1", "pr3"]);
  const [pr1, pr3] = items;
  assert.equal(pr1.input, "pr1");
  assert.equal(pr1.expected.kind, "defect");
  const d = pr1.expected.kind === "defect" ? pr1.expected : assert.fail();
  assert.equal(d.source, "escaped");
  assert.equal(d.defects.length, 1);
  assert.deepEqual({ ...d.defects[0], fix_diff: undefined }, {
    file: CALC, start_line: 12, end_line: 12, category: "calculation", severity: "high",
    description: "The discount adds the rate instead of subtracting it.", fix_commit: s.sha.c8.slice(0, 10), fix_diff: undefined,
  });
  assert.match(d.defects[0].fix_diff, /^-  return total \* \(1 \+ rate\)$/m);
  assert.deepEqual(pr1.tags, ["escaped", "calculation", "high"]);
  assert.equal((pr1.provenance as { label: string }).label, "human-confirmed");
  const head = (await fs.readFile(path.join(s.repo.dir, CALC), "utf-8")).split("\n");
  assert.notEqual(head[11], "  return total * (1 + rate)", "the working tree is past the fix");

  const d3 = pr3.expected.kind === "defect" ? pr3.expected : assert.fail();
  assert.deepEqual([d3.defects[0].file, d3.defects[0].start_line, d3.defects[0].category], ["src/tax.ts", 2, "other"]);
  assert.match(d3.defects[0].description, /^Fixed later by [0-9a-f]{10}: Corrige l'arrondi de la taxe$/);
  assert.deepEqual(pr3.tags, ["escaped", "other", "severity-unknown"]);

  const lines = (await fs.readFile(path.join(task, "items.jsonl"), "utf-8")).trim().split("\n").map((l) => JSON.parse(l) as Item);
  assert.deepEqual(lines, JSON.parse(JSON.stringify(items)));
  const written = JSON.parse(await fs.readFile(path.join(task, "code-review-build.json"), "utf-8"));
  assert.deepEqual(written.items.map((i: { id: string; merged_as: string }) => `${i.id}:${i.merged_as}`), ["pr1:rebase", "pr3:merge"]);
});

test("a fixture is the PR alone: its base as a root commit, its commits, nothing after its head", async () => {
  // Arrange
  const s = await shop();
  const task = await tmp("cr-task-");
  await build({ repo: s.repo.dir, mined: await minedShop(s, confirmAll), clean: null, taskDir: task, github: s.github, includeUnconfirmed: false });
  const pr = JSON.parse(await fs.readFile(path.join(task, "fixtures", "pr1", "pr.json"), "utf-8"));
  const clone = await tmp("cr-clone-");

  // Act
  sh(clone, "init", "-q");
  sh(clone, "fetch", "-q", path.join(task, "fixtures", "pr1", "repo.bundle"), "refs/fixtures/pr1");

  // Assert
  assert.deepEqual(await fs.readdir(path.join(task, "fixtures", "pr1")), ["pr.json", "repo.bundle"]);
  assert.equal(sh(clone, "rev-parse", "FETCH_HEAD").trim(), pr.headSha);
  assert.deepEqual(sh(clone, "log", "--format=%s", "FETCH_HEAD").trim().split("\n"), ["feat: use the discount at checkout and in the cart", "feat: add discount helper", "feat: initial shop"]);
  assert.equal(sh(clone, "rev-list", "--max-parents=0", "FETCH_HEAD").trim(), pr.baseSha);
  assert.equal(sh(clone, "rev-parse", "FETCH_HEAD^{tree}").trim(), sh(s.repo.dir, "rev-parse", `${s.sha.c2}^{tree}`).trim());
  assert.equal(sh(clone, "show", `FETCH_HEAD:${CALC}`).split("\n")[11], "  return total * (1 + rate)");
  assert.deepEqual(
    { number: pr.number, title: pr.title, body: pr.body, baseRefName: pr.baseRefName, commits: pr.commits.map((c: { messageHeadline: string }) => c.messageHeadline) },
    { number: 1, title: "Discount helper", body: "Body of #1", baseRefName: "main", commits: ["feat: add discount helper", "feat: use the discount at checkout"] },
  );
  assert.equal(pr.commits[1].oid, pr.headSha);
  assert.equal(sh(s.repo.dir, "for-each-ref", "refs/fixtures").trim(), "", "nothing was written into the source repo");
});

test("fixtures are byte-identical across rebuilds and however the source clone is packed", async () => {
  // Arrange: three copies of one history, packed three ways.
  const s = await shop();
  const loose = await tmp("cr-loose-");
  const gced = await tmp("cr-gc-");
  const shallowPacked = await tmp("cr-repack-");
  for (const d of [loose, gced, shallowPacked]) await fs.cp(s.repo.dir, d, { recursive: true });
  sh(gced, "gc", "-q", "--aggressive", "--prune=now");
  sh(shallowPacked, "repack", "-q", "-a", "-d", "-f", "--window=1", "--depth=1");
  const mined = await minedShop(s, confirmAll);

  // Act
  const trees: Record<string, Buffer>[] = [];
  for (const repo of [loose, gced, shallowPacked, loose]) {
    const task = await tmp("cr-det-");
    const { items, report } = await build({ repo, mined, clean: null, taskDir: task, github: s.github, includeUnconfirmed: false });
    await writeBuild(task, items, report);
    trees.push(await filesUnder(task));
  }

  // Assert
  assert.ok(Object.keys(trees[0]).includes(path.join("fixtures", "pr1", "repo.bundle")));
  for (const t of trees.slice(1)) {
    assert.deepEqual(Object.keys(t).sort(), Object.keys(trees[0]).sort());
    for (const [name, bytes] of Object.entries(trees[0])) assert.ok(bytes.equals(t[name]), `${name} differs`);
  }
});

/* ── pinned files ────────────────────────────────────────────────────────── */

test("a pinned path is exactly the pinned commit's in every tree, and the PR's own diff is unchanged", async () => {
  // Arrange: base with docs/a.md and docs/old.md; a PR that edits src/x.ts; a later commit that rewrites docs/ and adds CLAUDE.md.
  const dir = await tmp("cr-pin-");
  const repo = new TestRepo(dir);
  repo.git("init", "-q", "-b", "main");
  const base = await repo.commit("feat: start", { "docs/a.md": "old a\n", "docs/old.md": "gone later\n", "src/x.ts": "export const x = 1\n" });
  const pr = await repo.commit("feat: two", { "src/x.ts": "export const x = 2\n" });
  const later = await repo.commit("docs: rules", { "docs/a.md": "new a\n", "docs/old.md": null, "CLAUDE.md": "# rules\n" });
  const pin = await resolvePin(dir, later.slice(0, 9), ["docs/", "CLAUDE.md"]);
  const out = path.join(await tmp("cr-pin-out-"), "repo.bundle");
  const clone = await tmp("cr-pin-clone-");

  // Act
  const built = await writeBundle(dir, base, [pr], "refs/fixtures/x", out, pin);
  sh(clone, "init", "-q");
  sh(clone, "fetch", "-q", out, "refs/fixtures/x");

  // Assert
  assert.equal(pin.commit, later);
  assert.deepEqual(pin.paths, ["docs", "CLAUDE.md"]);
  for (const rev of [built.baseSha, built.headSha]) {
    assert.deepEqual(sh(clone, "ls-tree", "-r", "--name-only", rev).trim().split("\n"), ["CLAUDE.md", "docs/a.md", "src/x.ts"]);
    assert.equal(sh(clone, "show", `${rev}:docs/a.md`), "new a\n");
  }
  assert.equal(sh(clone, "diff", "--name-only", built.baseSha, built.headSha).trim(), "src/x.ts");
  assert.equal(sh(dir, "for-each-ref").trim().split("\n").length, 1, "nothing was written into the source repo");
});

test("a pin refuses an option-like revision, a path outside the repo, and a path the pinned commit lacks", async () => {
  const s = await shop();
  await assert.rejects(resolvePin(s.repo.dir, "--output=x", ["README.md"]), /must not start with "-"/);
  await assert.rejects(resolvePin(s.repo.dir, s.sha.c17, []), /at least one path/);
  for (const bad of ["/etc/passwd", "../x", "src/../README.md", ""]) {
    await assert.rejects(resolvePin(s.repo.dir, s.sha.c17, [bad]), /relative path inside the repository/, bad);
  }
  await assert.rejects(resolvePin(s.repo.dir, s.sha.c17, ["NOPE.md"]), /NOPE\.md is not in [0-9a-f]{9}/);
  await assert.rejects(resolvePin(s.repo.dir, "no-such-rev", ["README.md"]), /no commit no-such-rev/);
});

test("build overlays pinned files on every fixture, records the pin, flags a PR that edited a pinned path, and stays byte-identical", async () => {
  // Arrange: PR #3 edits src/tax.ts; PR #1 does not.
  const s = await shop();
  const mined = await minedShop(s, confirmAll);
  const pin = await resolvePin(s.repo.dir, s.sha.c17, ["README.md", "src/tax.ts"]);

  // Act
  const trees: Record<string, Buffer>[] = [];
  const reports = [];
  for (let i = 0; i < 2; i++) {
    const task = await tmp("cr-pinned-");
    const { items, report } = await build({ repo: s.repo.dir, mined, clean: null, taskDir: task, github: s.github, includeUnconfirmed: false, pin });
    await writeBuild(task, items, report);
    trees.push(await filesUnder(task));
    reports.push(report);
  }

  // Assert
  const report = reports[0];
  assert.deepEqual(report.pinned, { commit: s.sha.c17, paths: ["README.md", "src/tax.ts"] });
  assert.deepEqual(report.pinned_edited, [{ item: "pr3", paths: ["src/tax.ts"] }]);
  for (const [name, bytes] of Object.entries(trees[0])) assert.ok(bytes.equals(trees[1][name]), `${name} differs`);
  const pr1 = JSON.parse(trees[0][path.join("fixtures", "pr1", "pr.json")].toString("utf-8"));
  const clone = await tmp("cr-pinned-clone-");
  sh(clone, "init", "-q");
  await fs.writeFile(path.join(clone, "pr1.bundle"), trees[0][path.join("fixtures", "pr1", "repo.bundle")]);
  sh(clone, "fetch", "-q", path.join(clone, "pr1.bundle"), "refs/fixtures/pr1");
  assert.equal(sh(clone, "show", `${pr1.baseSha}:src/tax.ts`), sh(s.repo.dir, "show", `${s.sha.c17}:src/tax.ts`));
  assert.equal(sh(clone, "diff", "--name-only", pr1.baseSha, pr1.headSha).trim().split("\n").sort().join(","), ["src/checkout.ts", CALC].sort().join(","));
});

test("the CLI takes --pin-files REV PATH... and refuses stray arguments without it", async () => {
  const s = await shop();
  const mined = await tmp("cr-mined-");
  await main(["code-review", "mine", s.repo.dir, "--since", "2025-01-01", "--branch", "main", "--out", mined], bufferIo());
  const m = await readMined(mined);
  await fs.writeFile(path.join(mined, "candidates.json"), JSON.stringify({ ...m, candidates: m.candidates.map((c) => ({ ...c, confirmed: c.introducing.sha === s.sha.c1 })) }));
  const task = await tmp("cr-task-");

  const io = bufferIo();
  assert.equal(await main(["code-review", "build", s.repo.dir, "--mined", mined, "--task", task, "--pin-files", s.sha.c17, "README.md", "src/"], io), EXIT.ok, io.stderr);
  const report = JSON.parse(await fs.readFile(path.join(task, "code-review-build.json"), "utf-8"));
  assert.deepEqual(report.pinned, { commit: s.sha.c17, paths: ["README.md", "src"] });
  assert.match(io.stdout, /pinned README\.md, src from [0-9a-f]{9}/);
  assert.match(io.stdout, /edited a pinned path: c[0-9a-f]{7} \(src\/prix ünï\/calc côté\.ts\)/);

  await assert.rejects(main(["code-review", "build", s.repo.dir, "--mined", mined, "--task", task, "README.md"], bufferIo()), (e: Error) => e instanceof UsageError && /after --pin-files REV/.test(e.message));
  await assert.rejects(main(["code-review", "build", s.repo.dir, "--mined", mined, "--task", task, "--pin-files", s.sha.c17], bufferIo()), (e: Error) => e instanceof UsageError && /at least one path/.test(e.message));
  await assert.rejects(main(["code-review", "build", s.repo.dir, "--mined", mined, "--task", task, "--pin-files", s.sha.c17, "NOPE"], bufferIo()), (e: Error) => e instanceof UsageError && /NOPE is not in/.test(e.message));
});

test("pr.json is fixed by what GitHub says of the PR: the same answers give the same bytes, an edited title new ones", async () => {
  // Arrange
  const s = await shop();
  const mined = await minedShop(s, confirmAll);
  const edited: typeof s.github = { ...s.github, pull: async (n) => ({ ...(await s.github.pull(n)), title: "Discount helper (edited after merge)" }) };
  const prJson = async (github: typeof s.github): Promise<{ pr: Buffer; bundle: Buffer }> => {
    const task = await tmp("cr-prjson-");
    await build({ repo: s.repo.dir, mined, clean: null, taskDir: task, github, includeUnconfirmed: false });
    const dir = path.join(task, "fixtures", "pr1");
    return { pr: await fs.readFile(path.join(dir, "pr.json")), bundle: await fs.readFile(path.join(dir, "repo.bundle")) };
  };

  // Act
  const [a, b, c] = [await prJson(s.github), await prJson(s.github), await prJson(edited)];

  // Assert
  assert.ok(a.pr.equals(b.pr));
  assert.ok(!a.pr.equals(c.pr), "an edited title is a different fixture, so a different trial identity");
  assert.ok(a.bundle.equals(c.bundle), "the repository does not depend on GitHub's text");
  assert.deepEqual(Object.keys(JSON.parse(a.pr.toString("utf-8"))), ["repo", "number", "title", "body", "createdAt", "baseRefName", "baseSha", "headSha", "commits"]);
});

test("a bundle verifies with git and needs no prerequisite", async () => {
  const s = await shop();
  const out = path.join(await tmp("cr-bundle-"), "repo.bundle");
  await writeBundle(s.repo.dir, s.sha.c0, [s.sha.c1], "refs/fixtures/x", out);
  const verify = execFileSync("git", ["bundle", "verify", out], { cwd: s.repo.dir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...ISOLATED_GIT_ENV } });
  assert.match(verify, /refs\/fixtures\/x/);
  assert.doesNotMatch(verify, /requires/);
});

test("only confirmed candidates go in unless --include-unconfirmed, and a false never does", async () => {
  // Arrange
  const s = await shop();
  const mined = await minedShop(s, (m) => ({
    ...m,
    candidates: m.candidates.map((c) => ({ ...c, confirmed: c.introducing.unit.kind === "pr" && c.introducing.unit.number === 3 ? false : null })),
  }));

  // Act
  const strict = await build({ repo: s.repo.dir, mined, clean: null, taskDir: await tmp("cr-t-"), github: s.github, includeUnconfirmed: false });
  const loose = await build({ repo: s.repo.dir, mined, clean: null, taskDir: await tmp("cr-t-"), github: s.github, includeUnconfirmed: true });

  // Assert
  assert.equal(strict.items.length, 0);
  assert.equal(strict.report.excluded.length, 2);
  assert.deepEqual(loose.items.map((i) => i.id), ["pr1"]);
  const prov = loose.items[0].provenance as { label: string; candidates: { label: string; confirmed: null }[] };
  assert.equal(prov.label, "includes unconfirmed candidates");
  assert.match(prov.candidates[0].label, /^unconfirmed \(included with --include-unconfirmed; not pre-screened\)$/);
  assert.deepEqual(loose.report.excluded.map((e) => e.reason), ["a person marked it not a defect"]);
});

test("a label's knowable becomes the item's tag, and a label never tags what it does not say", async () => {
  // Arrange
  const s = await shop();
  const knowableOf = (pr1: boolean | undefined, pr3: boolean | undefined) => (m: MinedFile): MinedFile => ({
    ...m,
    candidates: m.candidates.map((c) => {
      const knowable = c.introducing.unit.kind === "pr" && c.introducing.unit.number === 1 ? pr1 : pr3;
      return { ...c, confirmed: true, label: { category: "logic", severity: "low", ...(knowable === undefined ? {} : { knowable }) } };
    }),
  });

  // Act
  const { items } = await build({ repo: s.repo.dir, mined: await minedShop(s, knowableOf(false, true)), clean: null, taskDir: await tmp("cr-t-"), github: s.github, includeUnconfirmed: false });
  const unsaid = await build({ repo: s.repo.dir, mined: await minedShop(s, knowableOf(undefined, undefined)), clean: null, taskDir: await tmp("cr-t-"), github: s.github, includeUnconfirmed: false });

  // Assert
  assert.deepEqual(items.map((i) => [i.id, i.tags]), [["pr1", ["escaped", "logic", "low", "not-knowable"]], ["pr3", ["escaped", "logic", "low", "knowable"]]]);
  assert.deepEqual(unsaid.items.map((i) => i.tags), [["escaped", "logic", "low"], ["escaped", "logic", "low"]]);
  // Each defect says it too, so a PR holding both kinds can be read defect by defect.
  const knowableOfDefects = (list: typeof items) => list.map((i) => (i.expected as { defects: Array<{ knowable?: boolean }> }).defects.map((d) => d.knowable));
  assert.deepEqual(knowableOfDefects(items).map((ds) => [...new Set(ds)]), [[false], [true]]);
  assert.deepEqual(knowableOfDefects(unsaid.items).map((ds) => [...new Set(ds)]), [[undefined], [undefined]]);
});

test("a confirmation a label attributes to something other than a person is not called human-confirmed", async () => {
  // Arrange
  const s = await shop();
  const mined = await minedShop(s, (m) => ({
    ...m,
    candidates: m.candidates.map((c) => ({
      ...c,
      confirmed: true,
      ...(c.introducing.unit.kind === "pr" && c.introducing.unit.number === 1 ? { label: { confirmed_by: "model review 2026-11-24" } } : {}),
    })),
  }));

  // Act
  const { items } = await build({ repo: s.repo.dir, mined, clean: null, taskDir: await tmp("cr-t-"), github: s.github, includeUnconfirmed: false });

  // Assert
  const [pr1, pr3] = items.map((i) => i.provenance as { label: string; candidates: { label: string }[] });
  assert.equal(pr1.label, "confirmed by model review 2026-11-24");
  assert.equal(pr1.candidates[0].label, "confirmed by model review 2026-11-24");
  assert.equal(pr3.label, "human-confirmed");
  assert.equal(pr3.candidates[0].label, "human-confirmed");
});

test("a label whose knowable is not a boolean, or whose confirmed_by is not text, is refused by name", async () => {
  // Arrange
  const s = await shop();
  const dir = await tmp("cr-m-");
  const write = async (label: unknown): Promise<void> => {
    const mined = await minedShop(s, (m) => ({ ...m, candidates: m.candidates.map((c) => ({ ...c, confirmed: true, label: label as MinedFile["candidates"][number]["label"] })) }));
    await fs.writeFile(path.join(dir, "candidates.json"), JSON.stringify(mined));
  };

  // Act + Assert
  await write({ knowable: "no" });
  await assert.rejects(readMined(dir), /"label\.knowable" must be true or false, got "no"/);
  await write({ confirmed_by: "" });
  await assert.rejects(readMined(dir), /"label\.confirmed_by" must be non-empty text, got ""/);
  await write({ knowable: false, confirmed_by: "model review" });
  assert.equal((await readMined(dir)).candidates[0].label?.knowable, false);
});

test("a candidate whose introducer is not in its PR's range is skipped with the reason", async () => {
  const s = await shop();
  const mined = await minedShop(s, (m) => confirmAll({
    ...m,
    candidates: m.candidates.map((c) => (c.introducing.unit.kind === "pr" && c.introducing.unit.number === 1 ? { ...c, introducing: { ...c.introducing, unit: { kind: "pr", number: 2, title: "Add logging", merged_at: null } } } : c)),
  }));
  const { items, report } = await build({ repo: s.repo.dir, mined, clean: null, taskDir: await tmp("cr-t-"), github: s.github, includeUnconfirmed: false });
  assert.deepEqual(items.map((i) => i.id), ["pr3"]);
  assert.match(report.skipped[0].reason, /^introducer [0-9a-f]{9} is not among the PR's 1 commits \(squash merge\)$/);
});

test("lines the PR head no longer holds keep their file, with no line numbers and a note", async () => {
  const s = await shop();
  const blamed = [{ file: CALC, line: 12, sha: s.sha.c1, orig_file: CALC, orig_line: 12 }];
  const found = await locateDefect(s.repo.dir, s.sha.c7, s.sha.c2, blamed, new Set([s.sha.c1]));
  const lost = await locateDefect(s.repo.dir, s.sha.c14, s.sha.c2, blamed, new Set([s.sha.c1]));
  const notMine = await locateDefect(s.repo.dir, s.sha.c7, s.sha.c2, blamed, new Set([s.sha.c2]));
  assert.deepEqual(found, [{ file: CALC, start_line: 12, end_line: 12, found: 1, of: 1 }]);
  assert.deepEqual(lost, [{ file: CALC, found: 0, of: 1, note: "none of the removed lines is in the file at the PR head" }]);
  assert.deepEqual(notMine, []);
});

test("the CLI builds from a mine without GitHub: each commit its own fixture", async () => {
  // Arrange
  const s = await shop();
  const mined = await tmp("cr-mined-");
  const task = await tmp("cr-task-");
  assert.equal(await main(["code-review", "mine", s.repo.dir, "--since", "2025-01-01", "--branch", "main", "--out", mined], bufferIo()), EXIT.ok);
  const m = await readMined(mined);
  const target = m.candidates.find((c) => c.introducing.sha === s.sha.c1)!;
  await fs.writeFile(path.join(mined, "candidates.json"), JSON.stringify({ ...m, candidates: m.candidates.map((c) => ({ ...c, confirmed: c.id === target.id })) }));
  const io = bufferIo();

  // Act
  const code = await main(["code-review", "build", s.repo.dir, "--mined", mined, "--task", task], io);

  // Assert
  assert.equal(code, EXIT.ok, io.stderr);
  const id = `c${s.sha.c1.slice(0, 7)}`;
  assert.match(io.stdout, /^1 items \(1 escaped, 0 clean\)/);
  assert.deepEqual(await fs.readdir(path.join(task, "fixtures")), [id]);
  const pr = JSON.parse(await fs.readFile(path.join(task, "fixtures", id, "pr.json"), "utf-8"));
  assert.deepEqual([pr.number, pr.title, pr.commits.length], [null, "feat: add discount helper", 1]);
  const [item] = (await fs.readFile(path.join(task, "items.jsonl"), "utf-8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual([item.expected.defects[0].file, item.expected.defects[0].start_line], [CALC, 12]);
});

test("the CLI says how to proceed when nothing is confirmed", async () => {
  const s = await shop();
  const mined = await tmp("cr-mined-");
  await main(["code-review", "mine", s.repo.dir, "--since", "2025-01-01", "--branch", "main", "--out", mined], bufferIo());
  const io = bufferIo();
  assert.equal(await main(["code-review", "build", s.repo.dir, "--mined", mined, "--task", await tmp("cr-task-")], io), EXIT.ok);
  assert.match(io.stdout, /Nothing is confirmed yet/);
});

test("agenteval's own items loader reads what build writes", async () => {
  const s = await shop();
  const task = await tmp("cr-task-");
  const { items, report } = await build({ repo: s.repo.dir, mined: await minedShop(s, confirmAll), clean: null, taskDir: task, github: s.github, includeUnconfirmed: false });
  await writeBuild(task, items, report);
  const loaded = readItems(task, "items.jsonl");
  assert.deepEqual(loaded.map((i) => [i.id, i.input, i.tags[0]]), [["pr1", "pr1\n", "escaped"], ["pr3", "pr3\n", "escaped"]]);
  assert.equal(JSON.parse(loaded[0].expected!).defects[0].file, CALC);
});

test("at GitHub's 250-commit cap, a range whose base still belongs to the PR is skipped", async () => {
  // Arrange: a root commit, then 250 commits a PR rebased onto it.
  const { GITHUB_COMMIT_CAP } = await import("../src/code-review/pr-range.js");
  const dir = await tmp("cr-cap-");
  sh(dir, "init", "-q", "-b", "main");
  const stream = Array.from({ length: GITHUB_COMMIT_CAP + 1 }, (_, i) => [
    "commit refs/heads/main", `mark :${i + 1}`, `committer A <a@example.com> ${1735725600 + i} +0000`,
    `data ${`c${i}`.length}`, `c${i}`, ...(i > 0 ? [`from :${i}`] : []), `M 644 inline f.txt`, `data ${String(i).length}`, String(i), "",
  ].join("\n")).join("\n");
  execFileSync("git", ["fast-import", "--quiet"], { cwd: dir, input: stream, env: { ...process.env, ...ISOLATED_GIT_ENV } });
  const tip = sh(dir, "rev-parse", "main").trim();
  const root = sh(dir, "rev-list", "--max-parents=0", "main").trim();
  const summary = { number: 9, title: "Big", mergedAt: "2025-01-02T00:00:00Z", baseRef: "main", mergeCommitSha: tip, author: "a", isBot: false };
  const commits = Array.from({ length: GITHUB_COMMIT_CAP }, (_, i) => ({ sha: "f".repeat(40), headline: `c${i + 1}` }));
  const github = (rootIsInPr: boolean) => ({
    repo: "o/r",
    pullsForCommit: async (sha: string) => (sha === root && rootIsInPr ? [summary] : []),
    pull: async () => ({ ...summary, body: "", createdAt: "", commitCount: GITHUB_COMMIT_CAP, commits }),
    mergedPulls: async () => [],
  });
  const unit = { kind: "pr" as const, number: 9, title: "Big", merged_at: null };

  // Act
  const fits = await resolveRange(dir, unit, github(false));
  const longer = await resolveRange(dir, unit, github(true));

  // Assert
  assert.ok("range" in fits && fits.range.kind === "rebase" && fits.range.base === root && fits.range.replay.length === GITHUB_COMMIT_CAP, JSON.stringify(fits).slice(0, 200));
  assert.deepEqual(longer, { skip: `PR #9 has more than the ${GITHUB_COMMIT_CAP} commits GitHub lists: its base is unknown` });
});
