/**
 * The optional LLM pre-screen of mined candidates, with a fake model.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BLAME, mine } from "../src/code-review/mine.js";
import { parseVerdict, prescreen, systemPrompt, type Completer } from "../src/code-review/prescreen.js";
import { candidatesMarkdown } from "../src/code-review/candidates-file.js";
import { CATEGORIES } from "../src/code-review/types.js";
import { bufferIo } from "../src/cli/io.js";
import { main } from "../src/cli/index.js";
import { buildShopRepo, type ShopRepo } from "./helpers/code-review-repo.js";

let shopPromise: Promise<ShopRepo> | undefined;
const shop = (): Promise<ShopRepo> => (shopPromise ??= buildShopRepo());

const minedShop = async (s: ShopRepo) => mine({
  repo: s.repo.dir, branch: "main", head: s.sha.c17, since: "2025-01-01", until: null, fixPattern: "^corrige",
  maxRemovedLines: 40, minOwnerShare: 0.6, blame: DEFAULT_BLAME, github: s.github,
});

test("the pre-screen shows the model both commits and records its verdict on each candidate", async () => {
  // Arrange
  const s = await shop();
  const mined = await minedShop(s);
  const prompts: string[] = [];
  const fake: Completer = async ({ prompt }) => {
    prompts.push(prompt);
    return { text: 'Sure.\n{"verdict":"defect","category":"calculation","severity":"high","visible_in_introducing_diff":true,"defect":"adds the rate","confidence":0.9,"reason":"r"}', costUsd: 0.01 };
  };

  // Act
  const out = await prescreen(mined, { repo: s.repo.dir, model: "test/model", limit: 1, completer: fake });

  // Assert
  assert.equal(out.screened, 1);
  assert.equal(out.costUsd, 0.01);
  const [first, second] = out.mined.candidates;
  assert.deepEqual(first.prescreen, {
    model: "test/model", verdict: "defect", category: "calculation", severity: "high", visible_in_introducing_diff: true,
    defect: "adds the rate", confidence: 0.9, reason: "r", cost_usd: 0.01,
  });
  assert.equal(second.prescreen, undefined, "--prescreen-limit 1 screens one");
  assert.match(prompts[0], /INTRODUCING PR #\d+/);
  assert.match(prompts[0], /FIX DIFF:\n[\s\S]*^-/m);
  assert.equal(first.confirmed, null, "a verdict never confirms");
  assert.match(candidatesMarkdown(out.mined), /\| defect 0\.9 \| calculation \/ high \| adds the rate \|  \|$/m);

  // A second pass with the same model screens only what is left.
  const again = await prescreen(out.mined, { repo: s.repo.dir, model: "test/model", limit: null, completer: fake });
  assert.equal(again.screened, mined.candidates.length - 1);
});

test("a reply that is not a verdict, or a failed call, is kept as an error row, not dropped", async () => {
  const s = await shop();
  const mined = await minedShop(s);
  const failing: Completer = async () => {
    throw new Error("HTTP 502");
  };
  const out = await prescreen(mined, { repo: s.repo.dir, model: "m", limit: 1, completer: failing });
  assert.deepEqual(out.mined.candidates[0].prescreen, { model: "m", verdict: "error", reason: "HTTP 502" });
  assert.equal(parseVerdict("no json here", "m", 0).verdict, "error");
  assert.equal(parseVerdict('{"verdict":"maybe"}', "m", 0).reason, 'unknown verdict "maybe"');
});

test("the prompt names the repo and offers exactly the contract's taxonomy", () => {
  const p = systemPrompt("owner/repo");
  assert.match(p, /history of owner\/repo/);
  for (const c of CATEGORIES) assert.ok(p.includes(`"${c}"`), c);
  assert.ok(!p.includes('"content"') && !p.includes('"build"'));
});

test("--prescreen-limit without --prescreen is a usage error", async () => {
  const s = await shop();
  await assert.rejects(main(["code-review", "mine", s.repo.dir, "--since", "2025-01-01", "--out", "/tmp/never", "--prescreen-limit", "3"], bufferIo()), /--prescreen-limit needs --prescreen MODEL/);
});
