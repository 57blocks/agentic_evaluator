/**
 * `code-review pick-clean` on the synthetic shop repo.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { apportion, binOf, pickClean, shuffled, type PickOptions } from "../src/code-review/pick-clean.js";
import { build } from "../src/code-review/build.js";
import { resolveRange } from "../src/code-review/pr-range.js";
import { DEFAULT_BLAME, mine } from "../src/code-review/mine.js";
import type { CleanFile, MinedFile } from "../src/code-review/types.js";
import { EXIT } from "../src/cli/exit-codes.js";
import { bufferIo } from "../src/cli/io.js";
import { main } from "../src/cli/index.js";
import { buildShopRepo, type ShopRepo } from "./helpers/code-review-repo.js";

let shopPromise: Promise<ShopRepo> | undefined;
const shop = (): Promise<ShopRepo> => (shopPromise ??= buildShopRepo());

async function minedShop(s: ShopRepo, withGitHub = true): Promise<MinedFile> {
  const mined = await mine({
    repo: s.repo.dir, branch: "main", head: s.sha.c17, since: "2025-01-01", until: null, fixPattern: null,
    maxRemovedLines: 40, minOwnerShare: 0.6, blame: DEFAULT_BLAME, github: withGitHub ? s.github : null,
  });
  return { ...mined, candidates: mined.candidates.map((c) => ({ ...c, confirmed: true })) };
}

function options(s: ShopRepo, mined: MinedFile, over: Partial<PickOptions> = {}): PickOptions {
  return { repo: s.repo.dir, mined, count: 3, seed: 7, since: "2025-01-01", until: null, github: s.github, ...over };
}

const prNumbers = (clean: CleanFile): number[] => clean.picked.map((p) => (p.unit.kind === "pr" ? p.unit.number : -1));

test("pick-clean draws merged PRs no fix blamed, never bots, housekeeping or escaped PRs", async () => {
  // Arrange
  const s = await shop();
  const mined = await minedShop(s);

  // Act: every eligible PR, so the exclusions are the whole story.
  const clean = await pickClean(options(s, mined, { count: 20 }));

  // Assert: #9 (51 changed lines) is eligible but outside the escaped PR's size bin.
  assert.deepEqual([...prNumbers(clean)].sort((a, b) => a - b), [2, 3, 6, 8, 11, 12, 13, 14]);
  const reasons = Object.fromEntries(clean.rejected.map((r) => [r.unit, r.reason]));
  assert.equal(reasons.pr1, "an escaped-defect candidate");
  assert.equal(reasons.pr4, "housekeeping title");
  assert.equal(reasons.pr5, "bot (dependabot[bot])");
  assert.equal(reasons.pr7, "a later fix blamed a line it wrote");
  assert.equal(reasons.pr10, "a later fix blamed a line it wrote");
  assert.equal(clean.seed, 7);
  assert.equal(clean.matched_to, "1 confirmed escaped PRs of 1");
});

test("the draw is fixed by the seed and size-matched to the escaped set", async () => {
  // Arrange
  const s = await shop();
  const mined = await minedShop(s);

  // Act
  const a = await pickClean(options(s, mined));
  const b = await pickClean(options(s, mined));
  const seeds = await Promise.all([1, 2, 3, 4, 5].map((seed) => pickClean(options(s, mined, { seed }))));

  // Assert
  assert.deepEqual(a, b);
  assert.equal(a.picked.length, 3);
  assert.ok(a.picked.every((p) => p.bin === "1-50" && p.lines < 50));
  assert.deepEqual(a.bins.map((x) => [x.escaped, x.want, x.got]), [[1, 3, 3], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  assert.ok(new Set(seeds.map((c) => prNumbers(c).sort().join(","))).size > 1, "different seeds draw differently");
});

test("apportion, binning and the shuffle are the small pure pieces they look like", () => {
  assert.deepEqual(apportion(14, [4, 7, 3, 3]), [3, 6, 3, 2]);
  assert.deepEqual(apportion(3, [0, 0]), [0, 0]);
  assert.deepEqual([0, 1, 49, 50, 199, 200, 999, 1000, 4999, 5000, 1e6].map(binOf), [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual(shuffled([1, 2, 3, 4, 5], 42), shuffled([1, 2, 3, 4, 5], 42));
  assert.deepEqual([...shuffled([1, 2, 3, 4, 5], 42)].sort(), [1, 2, 3, 4, 5]);
});

test("picked clean PRs build as clean items, squash and merge commits included", async () => {
  // Arrange
  const s = await shop();
  const mined = await minedShop(s);
  const clean = await pickClean(options(s, mined, { count: 20 }));

  // Act
  const { items, report } = await build({ repo: s.repo.dir, mined: { ...mined, candidates: [] }, clean, taskDir: await fs.mkdtemp(path.join(os.tmpdir(), "cr-t-")), github: s.github, includeUnconfirmed: false });

  // Assert
  assert.equal(items.length, 8);
  assert.ok(items.every((i) => i.id.endsWith("-clean") && i.expected.kind === "clean" && i.tags[0] === "clean"));
  const mergedAs = Object.fromEntries(report.items.map((i) => [i.id, i.merged_as]));
  assert.equal(mergedAs["pr2-clean"], "squash");
  assert.equal(mergedAs["pr3-clean"], "merge");
});

test("the CLI picks commits when the mine had no GitHub, and exits partial when it cannot fill the count", async () => {
  // Arrange
  const s = await shop();
  const minedDir = await fs.mkdtemp(path.join(os.tmpdir(), "cr-mined-"));
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "cr-clean-"));
  assert.equal(await main(["code-review", "mine", s.repo.dir, "--since", "2025-01-01", "--branch", "main", "--out", minedDir], bufferIo()), EXIT.ok);
  const io = bufferIo();

  // Act
  const code = await main(["code-review", "pick-clean", s.repo.dir, "--mined", minedDir, "--count", "50", "--out", out], io);

  // Assert
  assert.equal(code, EXIT.partial);
  const clean = JSON.parse(await fs.readFile(path.join(out, "clean.json"), "utf-8")) as CleanFile;
  assert.ok(clean.picked.length > 0 && clean.picked.every((p) => p.unit.kind === "commit"));
  assert.equal(clean.seed, 20261119);
  assert.match(clean.matched_to, /unreviewed escaped \(none confirmed yet\) commits/);
  assert.match(io.stdout, /clean picked \(seed 20261119;/);
  await assert.rejects(main(["code-review", "pick-clean", s.repo.dir, "--mined", minedDir, "--out", out], bufferIo()), /--count N is required/);
});

test("a commit id from a file that git would read as an option is refused before any git call", async () => {
  // Arrange: a tampered candidates.json whose head is an option.
  const s = await shop();
  const minedDir = await fs.mkdtemp(path.join(os.tmpdir(), "cr-mined-"));
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "cr-clean-"));
  const mined = await minedShop(s, false);
  const planted = path.join(out, "planted");
  await fs.writeFile(path.join(minedDir, "candidates.json"), JSON.stringify({ ...mined, repo: { ...mined.repo, head: `--output=${planted}` } }));

  // Act + Assert
  await assert.rejects(main(["code-review", "pick-clean", s.repo.dir, "--mined", minedDir, "--count", "1", "--out", out], bufferIo()), /repo\.head is not a commit id: "--output=/);
  await assert.rejects(main(["code-review", "build", s.repo.dir, "--mined", minedDir, "--task", out], bufferIo()), /repo\.head is not a commit id/);
  await assert.rejects(pickClean(options(s, { ...mined, repo: { ...mined.repo, head: "--output=x" } })), /not a commit id/);
  const blamed = { ...mined.candidates[0], blamed: [{ ...mined.candidates[0].blamed[0], sha: "--all" }] };
  await assert.rejects(build({ repo: s.repo.dir, mined: { ...mined, candidates: [blamed] }, clean: null, taskDir: out, github: null, includeUnconfirmed: true }), /blamed is not a commit id/);
  await assert.rejects(fs.access(planted));
});

test("a branch or a GitHub merge commit that looks like an option resolves to nothing", async () => {
  const s = await shop();
  await assert.rejects(main(["code-review", "mine", s.repo.dir, "--since", "2025-01-01", "--branch", "--output=x", "--out", "/tmp/never"], bufferIo()), /no branch --output=x/);
  const evil = { ...s.github, pull: async (n: number) => ({ ...(await s.github.pull(n)), mergeCommitSha: "--output=x" }) };
  const got = await resolveRange(s.repo.dir, { kind: "pr", number: 1, title: "", merged_at: null }, evil);
  assert.deepEqual(got, { skip: `PR #1: GitHub's merge commit "--output=x" is not a commit id` });
});

test("GitHub's size hint passes over PRs whose bin is full without asking GitHub for them", async () => {
  const s = await shop();
  const mined = await minedShop(s);
  let asked = 0;
  const hinted = {
    ...s.github,
    mergedPulls: async (base: string, since: string, until: string | null) => (await s.github.mergedPulls(base, since, until)).map((p) => ({ ...p, changedLines: 4000 })),
    pull: async (n: number) => {
      asked += 1;
      return s.github.pull(n);
    },
  };
  const clean = await pickClean(options(s, mined, { github: hinted }));
  assert.equal(clean.picked.length, 0, "every PR claims 4000 lines; the escaped one is in 1-50");
  assert.equal(asked, 1, "only the escaped PR is resolved, to size the bins");
});
