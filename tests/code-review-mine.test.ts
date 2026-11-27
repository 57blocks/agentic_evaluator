/**
 * `code-review mine` on a synthetic repo whose bug, fix and decoys are known.
 */

import { windowArgs } from "../src/code-review/git.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { carryOver, DEFAULT_BLAME, mine, type MineOptions } from "../src/code-review/mine.js";
import { candidatesMarkdown, readMined } from "../src/code-review/candidates-file.js";
import { blameLines, NOT_CODE } from "../src/code-review/szz.js";
import { EXIT } from "../src/cli/exit-codes.js";
import { bufferIo } from "../src/cli/io.js";
import { main } from "../src/cli/index.js";
import { buildShopRepo, CALC, type ShopRepo } from "./helpers/code-review-repo.js";

let shopPromise: Promise<ShopRepo> | undefined;
const shop = (): Promise<ShopRepo> => (shopPromise ??= buildShopRepo());

function options(s: ShopRepo, over: Partial<MineOptions> = {}): MineOptions {
  return {
    repo: s.repo.dir, branch: "main", head: s.sha.c17, since: "2025-01-01", until: null, fixPattern: null,
    maxRemovedLines: 40, minOwnerShare: 0.6, blame: DEFAULT_BLAME, github: s.github, ...over,
  };
}

test("mine pairs the discount fix with the PR that wrote the bug, and drops every decoy with its reason", async () => {
  // Arrange
  const s = await shop();

  // Act
  const mined = await mine(options(s));

  // Assert
  assert.deepEqual(mined.candidates.map((c) => c.id), [`pr1-fix${s.sha.c8.slice(0, 7)}`]);
  const [c] = mined.candidates;
  assert.equal(c.introducing.sha, s.sha.c1);
  assert.deepEqual(c.introducing.unit, { kind: "pr", number: 1, title: "Discount helper", merged_at: "2025-01-03T12:00:00Z" });
  assert.equal(c.fix.unit.kind === "pr" && c.fix.unit.number, 6);
  assert.deepEqual(c.files, [CALC]);
  assert.equal(c.removed_lines, 1);
  assert.equal(c.introducing.share, 1);
  assert.deepEqual(c.blamed, [{ file: CALC, line: 12, sha: s.sha.c1, orig_file: CALC, orig_line: 12 }]);
  assert.equal(c.confirmed, null);

  const reasons = Object.fromEntries(mined.dropped.map((d) => [d.fix, d.reason]));
  assert.equal(reasons[s.sha.c10], "introducer is chore/style/ci");
  assert.match(reasons[s.sha.c11], /removed 50 lines of code \(more than 40\)/);
  assert.equal(reasons[s.sha.c13], "introducer and fix landed in the same PR");
  assert.match(reasons[s.sha.c14], /owns 50% .*under 60%/);
  assert.equal(reasons[s.sha.c15], "removed no lines of code");
  assert.equal(reasons[s.sha.c17], undefined, "not a fix without --fix-pattern");
  assert.deepEqual(mined.scanned, { commits: 17, fixes: 6 });
});

test("introducers lists every commit any fix blamed, before the filters", async () => {
  const s = await shop();
  const mined = await mine(options(s));
  for (const k of ["c0", "c1", "c9", "c12"]) assert.ok(mined.introducers.includes(s.sha[k]), `${k} missing`);
  assert.ok(!mined.introducers.includes(s.sha.c16));
});

test("with no GitHub each commit is its own unit, so a bug and its fix in one PR become a candidate", async () => {
  const s = await shop();
  const mined = await mine(options(s, { github: null }));
  const ids = mined.candidates.map((c) => c.id);
  assert.ok(ids.includes(`c${s.sha.c1.slice(0, 7)}-fix${s.sha.c8.slice(0, 7)}`));
  assert.ok(ids.includes(`c${s.sha.c12.slice(0, 7)}-fix${s.sha.c13.slice(0, 7)}`));
  assert.equal(mined.repo.github, null);
});

test("--fix-pattern adds fixes the conventional prefix misses, and a merge-commit PR is a unit", async () => {
  const s = await shop();
  const mined = await mine(options(s, { fixPattern: "^corrige" }));
  const c = mined.candidates.find((x) => x.fix.sha === s.sha.c17);
  assert.ok(c, "the french fix is found");
  assert.equal(c.introducing.sha, s.sha.c5);
  assert.equal(c.id, `pr3-fix${s.sha.c17.slice(0, 7)}`);
});

test("blame with -M -C follows a line moved to another file in the same commit", async () => {
  // Arrange: a line moved from a.ts to b.ts; plain blame credits the move.
  const s = await buildShopRepo();
  await s.repo.commit("feat: a", { "src/a.ts": "export const keep = 1\nexport const moved = computeSomethingRatherLong(1, 2, 3)\n" });
  const mover = await s.repo.commit("refactor: move", {
    "src/a.ts": "export const keep = 1\n",
    "src/b.ts": "export const moved = computeSomethingRatherLong(1, 2, 3)\nexport const other = 2\n",
  });

  // Act
  const plain = await blameLines(s.repo.dir, "HEAD", "src/b.ts", [{ start: 1, end: 1 }], ["-w"]);
  const following = await blameLines(s.repo.dir, "HEAD", "src/b.ts", [{ start: 1, end: 1 }], ["-w", "-M", "-C"]);

  // Assert
  assert.equal(plain[0].sha, mover);
  assert.notEqual(following[0].sha, mover);
  assert.equal(following[0].orig_file, "src/a.ts");
  assert.equal(following[0].orig_line, 2);
});

test("re-mining keeps a person's confirmed mark and label on the same pair", async () => {
  const s = await shop();
  const first = await mine(options(s));
  const marked = { ...first, candidates: first.candidates.map((c) => ({ ...c, confirmed: true, label: { category: "calculation", severity: "high" } })) };
  const { mined, carried } = carryOver(await mine(options(s)), marked);
  assert.equal(carried, 1);
  assert.equal(mined.candidates[0].confirmed, true);
  assert.deepEqual(mined.candidates[0].label, { category: "calculation", severity: "high" });
});

test("candidates.md is a table with an empty confirmed column and the reading instructions", async () => {
  const s = await shop();
  const md = candidatesMarkdown(await mine(options(s)));
  assert.match(md, /set `"confirmed": true`/);
  assert.match(md, /\| 1 \| pr1-fix[0-9a-f]{7} \| \[#1\]\(https:\/\/github\.com\/shop\/shop\/pull\/1\) Discount helper \| .* \| 1 \| 100% \|  \|  \|  \|  \|$/m);
});

test("the CLI mines without GitHub, writes both files, and keeps marks on a second run", async () => {
  // Arrange
  const s = await shop();
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "cr-mined-"));
  const io = bufferIo();

  // Act
  const code = await main(["code-review", "mine", s.repo.dir, "--since", "2025-01-01", "--branch", "main", "--out", out], io);
  const first = await readMined(out);
  await fs.writeFile(path.join(out, "candidates.json"), JSON.stringify({ ...first, candidates: first.candidates.map((c) => ({ ...c, confirmed: false })) }));
  const again = await main(["code-review", "mine", s.repo.dir, "--since", "2025-01-01", "--branch", "main", "--out", out], bufferIo());

  // Assert
  assert.equal(code, EXIT.ok, io.stderr);
  assert.equal(again, EXIT.ok);
  assert.match(io.stdout, /candidates\.json/);
  assert.ok((await fs.readFile(path.join(out, "candidates.md"), "utf-8")).includes("| confirmed |"));
  const second = await readMined(out);
  assert.ok(second.candidates.length >= 2);
  assert.ok(second.candidates.every((c) => c.confirmed === false));
});

test("the CLI refuses a bad date and an unknown subcommand as usage errors", async () => {
  const s = await shop();
  await assert.rejects(main(["code-review", "mine", s.repo.dir, "--since", "June", "--out", "/tmp/x"], bufferIo()), /--since must be YYYY-MM-DD/);
  await assert.rejects(main(["code-review", "frob"], bufferIo()), /unknown code-review subcommand "frob"/);
});

test("tests, docs, data and lockfiles are not code; MDX pages with components are", () => {
  for (const p of ["src/a.test.ts", "tests/x.ts", "docs/a.ts", "README.md", "package.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "site/locales/fr.yaml", "a/__snapshots__/x.snap", "logo.svg"]) {
    assert.ok(NOT_CODE.test(p), p);
  }
  for (const p of ["src/a.ts", "src/components/BlockQuote.tsx", "src/clock.ts", "site/pages/micro-bic.mdx", "règles/salarié.publicodes", "api/server.py"]) assert.ok(!NOT_CODE.test(p), p);
});

test("re-mining with other flags warns about marked pairs it no longer finds, and keeps the earlier file", async () => {
  // Arrange
  const s = await shop();
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "cr-mined-"));
  await main(["code-review", "mine", s.repo.dir, "--since", "2025-01-01", "--branch", "main", "--out", out], bufferIo());
  const first = await readMined(out);
  await fs.writeFile(path.join(out, "candidates.json"), JSON.stringify({ ...first, candidates: first.candidates.map((c) => ({ ...c, confirmed: true })) }));
  const io = bufferIo();

  // Act: a stricter share drops every pair.
  await main(["code-review", "mine", s.repo.dir, "--since", "2025-01-01", "--branch", "main", "--min-owner-share", "1", "--max-removed-lines", "0", "--out", out], io);

  // Assert
  assert.match(io.stderr, new RegExp(`no longer finds ${first.candidates.length} candidates a person had marked`));
  const kept = JSON.parse(await fs.readFile(path.join(out, "candidates.previous.json"), "utf-8"));
  assert.ok(kept.candidates.every((c: { confirmed: boolean }) => c.confirmed === true));
});

test("in a shallow clone, a fix whose blame stops at the boundary commit is dropped, not pinned on it", async () => {
  // Arrange: a clone cut after the buggy commit, so blame credits the cut point with the bug's line.
  const s = await shop();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cr-shallow-"));
  const { execFileSync } = await import("node:child_process");
  execFileSync("git", ["clone", "--quiet", "--depth", "12", "--branch", "main", `file://${s.repo.dir}`, dir]);
  const boundary = (await fs.readFile(path.join(dir, ".git", "shallow"), "utf-8")).trim().split("\n");
  assert.ok(!boundary.includes(s.sha.c1), "the buggy commit is outside the clone");

  // Act
  const mined = await mine(options(s, { repo: dir }));

  // Assert
  const drop = mined.dropped.find((d) => d.fix === s.sha.c8);
  assert.ok(drop, "the discount fix is dropped");
  assert.match(drop.reason, /shallow clone/);
  assert.ok(boundary.includes(drop.introducing ?? ""));
  assert.ok(!mined.candidates.some((c) => boundary.includes(c.introducing.sha)));
});

test("a candidates.json that no longer reads stops a re-mine: marks set by hand are never overwritten unread", async () => {
  // Arrange — a person confirmed candidates and left a trailing comma.
  const s = await shop();
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "cr-mined-"));
  await main(["code-review", "mine", s.repo.dir, "--since", "2025-01-01", "--branch", "main", "--out", out], bufferIo());
  const broken = (await fs.readFile(path.join(out, "candidates.json"), "utf-8")).replace(/\}\s*$/, ",}");
  await fs.writeFile(path.join(out, "candidates.json"), broken);

  // Act, Assert — refused, and the file is as the person left it.
  await assert.rejects(main(["code-review", "mine", s.repo.dir, "--since", "2025-01-01", "--branch", "main", "--out", out], bufferIo()), /not valid JSON/);
  assert.equal(await fs.readFile(path.join(out, "candidates.json"), "utf-8"), broken);
});

test("a date-only window covers whole days, whatever the clock says when mine runs", () => {
  // git reads a bare date as that date at the current time of day.
  assert.deepEqual(windowArgs("2025-06-01", "2025-06-30"), ["--since=2025-06-01T00:00:00", "--until=2025-06-30T23:59:59"]);
  assert.deepEqual(windowArgs("2025-06-01", null), ["--since=2025-06-01T00:00:00"]);
});
