/**
 * A small synthetic shop repo with a known history, for the code-review
 * builders: one escaped bug (written in rebase-merged PR #1, fixed later by
 * PR #6), fixes the miner must drop for each of its reasons, clean PRs merged
 * three ways (rebase, squash, merge commit), housekeeping and a bot. The bug
 * lives at a path with a space and non-ASCII letters.
 *
 * Git runs with no global or system config and fixed dates, so every build
 * of this repo has the same commit ids.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GitHub, PullDetail, PullSummary } from "../../src/code-review/github.js";

export const CALC = "src/prix ünï/calc côté.ts";

export const ISOLATED_GIT_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

export class TestRepo {
  private day = 0;
  constructor(readonly dir: string) {}

  git(...args: string[]): string {
    return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
      cwd: this.dir,
      encoding: "utf-8",
      env: { ...process.env, ...ISOLATED_GIT_ENV, ...this.dateEnv() },
    });
  }

  private dateEnv(author = "Ada Dev <ada@example.com>"): Record<string, string> {
    const date = new Date(Date.UTC(2025, 0, 1 + this.day, 10, 0, 0)).toISOString();
    const [, name, email] = /^(.*) <(.*)>$/.exec(author)!;
    return {
      GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: "Ada Dev", GIT_COMMITTER_EMAIL: "ada@example.com", GIT_COMMITTER_DATE: date,
    };
  }

  async write(files: Record<string, string | null>): Promise<void> {
    for (const [rel, text] of Object.entries(files)) {
      const abs = path.join(this.dir, rel);
      if (text === null) {
        await fs.rm(abs);
        continue;
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, text);
    }
  }

  /** Commit the given files on the current branch, one day after the last commit. */
  async commit(message: string, files: Record<string, string | null>, author?: string): Promise<string> {
    this.day += 1;
    await this.write(files);
    this.git("add", "-A");
    execFileSync("git", ["commit", "-q", "--no-gpg-sign", "-m", message], {
      cwd: this.dir,
      env: { ...process.env, ...ISOLATED_GIT_ENV, ...this.dateEnv(author) },
    });
    return this.git("rev-parse", "HEAD").trim();
  }

  async merge(branch: string, message: string): Promise<string> {
    this.day += 1;
    execFileSync("git", ["merge", "-q", "--no-ff", "--no-gpg-sign", "-m", message, branch], {
      cwd: this.dir,
      env: { ...process.env, ...ISOLATED_GIT_ENV, ...this.dateEnv() },
    });
    return this.git("rev-parse", "HEAD").trim();
  }
}

const calcBase = `export function total(price: number, qty: number): number {
  const subtotal = price * qty
  return subtotal
}

export function label(name: string): string {
  return name.trim()
}
`;

const discount = (body: string) => `${calcBase}
export function discount(total: number): number {
  const rate = 0.1
${body}
}
`;

const bigFile = Array.from({ length: 50 }, (_, i) => `export const v${i} = ${i}`).join("\n") + "\n";

export interface ShopRepo {
  repo: TestRepo;
  sha: Record<string, string>;
  github: FakeGitHub;
}

export async function buildShopRepo(): Promise<ShopRepo> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cr-shop-"));
  const repo = new TestRepo(dir);
  repo.git("init", "-q", "-b", "main");
  const sha: Record<string, string> = {};

  sha.c0 = await repo.commit("feat: initial shop", {
    [CALC]: calcBase,
    "src/util.ts": "export const id = (x: unknown) => x\n",
    "src/big.ts": bigFile,
    "src/tax.ts": "export const TAX = 0.2\n",
    "README.md": "# shop\n",
    "tests/calc.test.ts": "test('total', () => {})\n",
  });
  // PR #1, rebase-merged: the bug (adds the rate instead of subtracting it).
  sha.c1 = await repo.commit("feat: add discount helper", { [CALC]: discount("  return total * (1 + rate)") });
  // Its first paragraph runs over two lines: git's %s joins them, GitHub's headline does not.
  sha.c2 = await repo.commit("feat: use the discount at checkout\nand in the cart", {
    "src/checkout.ts": "import { discount } from './prix ünï/calc côté'\nexport const pay = (t: number) => discount(t)\n",
  });
  // PR #2, squash-merged from three branch commits.
  sha.c3 = await repo.commit("Add logging (#2)", { "src/util.ts": "export const id = (x: unknown) => x\nexport const log = (m: string) => console.log(m)\n" });
  // PR #3, a merge commit over two branch commits.
  repo.git("checkout", "-q", "-b", "feature/tax");
  sha.c4 = await repo.commit("feat: tax helper", { "src/tax.ts": "export const TAX = 0.2\nexport const withTax = (n: number) => n * (1 + TAX)\n" });
  sha.c5 = await repo.commit("feat: round tax", { "src/tax.ts": "export const TAX = 0.2\nexport const withTax = (n: number) => Math.floor(n * (1 + TAX))\n" });
  repo.git("checkout", "-q", "main");
  sha.m3 = await repo.merge("feature/tax", "Merge pull request #3 from shop/feature/tax\n\nfeat: tax");
  // PR #4 housekeeping, PR #5 a bot.
  sha.c6 = await repo.commit("chore: bump deps", { "package.json": '{"name":"shop","version":"1.0.1"}\n' });
  sha.c7 = await repo.commit("build(deps): bump left-pad", { "src/vendor.ts": "export const pad = 1\n" }, "dependabot[bot] <bot@example.com>");
  // PR #6: the fix of PR #1's bug.
  sha.c8 = await repo.commit("fix: subtract the discount rate", { [CALC]: discount("  return total * (1 - rate)") });
  // PR #7 rewrites a line as a style change; PR #8's fix of it must be dropped.
  sha.c9 = await repo.commit("style: quote the currency", { "src/money.ts": "export const CURRENCY = 'EUR'\n" });
  sha.c10 = await repo.commit("fix: currency code", { "src/money.ts": "export const CURRENCY = 'EUR ' \n" });
  // PR #9: a fix too large to be one defect.
  sha.c11 = await repo.commit("fix: rewrite the constants", { "src/big.ts": "export const ALL = []\n" });
  // PR #10, rebase-merged: a bug and its fix inside the same PR.
  sha.c12 = await repo.commit("feat: greet", { "src/greet.ts": "export const greet = (n: string) => `Helo ${n}`\n" });
  sha.c13 = await repo.commit("fix: greet typo", { "src/greet.ts": "export const greet = (n: string) => `Hello ${n}`\n" });
  // PR #11: one line from c0 and one from c1, so no commit owns 60%.
  sha.c14 = await repo.commit("fix: label and rate", {
    [CALC]: discount("  return total * (1 - rate)").replace("const rate = 0.1", "const rate = 0.15").replace("return name.trim()", "return name.trim().toUpperCase()"),
  });
  // PR #12: a test-only fix.
  sha.c15 = await repo.commit("fix: flaky test", { "tests/calc.test.ts": "test('total', async () => {})\n" });
  // PR #13: a clean feature.
  sha.c16 = await repo.commit("feat: currency list", { "src/currency.ts": "export const CURRENCIES = ['EUR', 'USD']\n" });
  // PR #14: a fix only --fix-pattern '^corrige' finds; its bug came in through merge PR #3.
  sha.c17 = await repo.commit("Corrige l'arrondi de la taxe", { "src/tax.ts": "export const TAX = 0.2\nexport const withTax = (n: number) => Math.round(n * (1 + TAX))\n" });

  return { repo, sha, github: shopGitHub(sha) };
}

export interface FakeGitHub extends GitHub {
  calls: string[];
}

/** GitHub as it would answer for the shop repo, with no network. */
export function shopGitHub(sha: Record<string, string>): FakeGitHub {
  const pr = (number: number, title: string, mergeCommitSha: string, day: number, extra: Partial<PullSummary> = {}): PullSummary => ({
    number, title, mergedAt: `2025-01-${String(day).padStart(2, "0")}T12:00:00Z`, baseRef: "main", mergeCommitSha, author: "ada", isBot: false, ...extra,
  });
  const pulls: PullSummary[] = [
    pr(1, "Discount helper", sha.c2, 3),
    pr(2, "Add logging", sha.c3, 4),
    pr(3, "Tax", sha.m3, 7),
    pr(4, "chore: bump deps", sha.c6, 8),
    pr(5, "build(deps): bump left-pad", sha.c7, 9, { author: "dependabot[bot]", isBot: true }),
    pr(6, "Fix the discount", sha.c8, 10),
    pr(7, "Quote the currency", sha.c9, 11),
    pr(8, "Fix the currency code", sha.c10, 12),
    pr(9, "Constants", sha.c11, 13),
    pr(10, "Greet", sha.c13, 15),
    pr(11, "Label and rate", sha.c14, 16),
    pr(12, "Flaky test", sha.c15, 17),
    pr(13, "Currency list", sha.c16, 18),
    pr(14, "Rounding", sha.c17, 19),
  ];
  const commitsOf: Record<number, { sha: string; headline: string }[]> = {
    1: [{ sha: "a".repeat(40), headline: "feat: add discount helper" }, { sha: "b".repeat(40), headline: "feat: use the discount at checkout" }],
    2: [{ sha: "c".repeat(40), headline: "wip" }, { sha: "d".repeat(40), headline: "logging" }, { sha: "e".repeat(40), headline: "review" }],
    3: [{ sha: sha.c4, headline: "feat: tax helper" }, { sha: sha.c5, headline: "feat: round tax" }],
    10: [{ sha: "f".repeat(40), headline: "feat: greet" }, { sha: "0".repeat(40), headline: "fix: greet typo" }],
  };
  const unitOf: Record<string, number> = {
    [sha.c1]: 1, [sha.c2]: 1, [sha.c3]: 2, [sha.c4]: 3, [sha.c5]: 3, [sha.m3]: 3, [sha.c6]: 4, [sha.c7]: 5, [sha.c8]: 6,
    [sha.c9]: 7, [sha.c10]: 8, [sha.c11]: 9, [sha.c12]: 10, [sha.c13]: 10, [sha.c14]: 11, [sha.c15]: 12, [sha.c16]: 13, [sha.c17]: 14,
  };
  const calls: string[] = [];
  return {
    repo: "shop/shop",
    calls,
    async pullsForCommit(s) {
      calls.push(`commit ${s.slice(0, 7)}`);
      const n = unitOf[s];
      return n === undefined ? [] : [pulls[n - 1]];
    },
    async pull(n): Promise<PullDetail> {
      calls.push(`pull ${n}`);
      const p = pulls[n - 1];
      const commits = commitsOf[n] ?? [{ sha: p.mergeCommitSha!, headline: p.title }];
      return { ...p, body: `Body of #${n}`, createdAt: "2025-01-01T09:00:00Z", commitCount: commits.length, commits };
    },
    async mergedPulls(base, since, until) {
      calls.push(`merged ${base} ${since}..${until}`);
      return pulls.filter((p) => p.mergedAt! >= since && (until === null || p.mergedAt!.slice(0, 10) <= until));
    },
  };
}
