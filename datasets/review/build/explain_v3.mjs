#!/usr/bin/env node
/**
 * For every claim-denials-snf-v3 and kyc-ubo-v3 item on this machine (dev,
 * calibration and, where its seed is here, holdout): what the item asks, how
 * its answer key follows from the rules, and what noise its input carries,
 * in Chinese, for the review workbook. Prints JSON:
 *   { "<id>": { question, steps: [..], noise: "..." } }
 *
 * Each item is rebuilt from its generator and compared with the committed
 * line; each Medicare deadline the steps reach is compared with the key, and
 * each KYC owner list with the key's. Any difference stops the run: the steps
 * would then describe a different item than the reviewer sees.
 *
 * Rules as of claim-denials v2.4 (a wrongful timely-filing denial is reopened;
 * R7 rolls a deadline off a weekend or federal holiday) and kyc-ubo v2.2.
 *
 *   node datasets/review/build/explain_v3.mjs [--lang=en] > derivations-v3.json
 */

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { explainKycItem } from "./explain.mjs";
import { CLAIM_EXPLAIN_EN, CLAIM_NOISE_EN, KYC_NOISE_EN, NO_NOISE_EN, explainKycItemEn } from "./explain_v3_en.mjs";

/** --lang=en writes the same steps in English (explain_v3_en.mjs); the default is Chinese. */
const EN = process.argv.includes("--lang=en");

const TASKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tasks");
const claimGen = await import(`${TASKS}/claim-denials-snf-v3/gen/generate.mjs`);
const kycGen = await import(`${TASKS}/kyc-ubo-v3/gen/generate.mjs`);
const { holdoutSeed } = await import(`${TASKS}/../gen-kit/splits.mjs`);
const R = await import(`${TASKS}/claim-denials-snf-v2/gen/rules.mjs`);

const SPLITS = { d: "dev", c: "calibration", h: "holdout" };

function readSplit(task, split) {
  const file = path.join(TASKS, task, ...(split === "holdout" ? ["holdout"] : []), `${task}.${split}.jsonl`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
}

/** The set seed an item was built from: dev and calibration share the public one; the holdout's is local. */
function setSeedFor(task, gen, split, env) {
  if (split !== "holdout") return gen.SEED;
  return `holdout:${holdoutSeed(path.join(TASKS, task), env)}`;
}

// ---------- claim-denials-snf-v3 ----------

/** "2026-10-17", or the date and its rollover when R7 moved it. */
const DOW = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
/** "周六" or "周一，联邦假日": what a reviewer needs to check R7 without a calendar. */
const dayNote = (iso) => `${DOW[dow(iso)]}${R.federalHolidays(Number(iso.slice(0, 4))).has(iso) ? "，联邦假日" : ""}`;
/** "2026-10-17（周六）顺延到 …", or the date with its weekday when R7 leaves it alone. */
function rolled(base) {
  const final = R.nextWorkday(base);
  return { final, text: final === base ? `${base}（${dayNote(base)}，是工作日，不顺延）` : `${base}（${dayNote(base)}），顺延到下一个工作日 ${final}（${dayNote(final)}）（R7）` };
}
const appeal = (remit) => {
  const r = rolled(R.redeterminationDeadline(remit));
  return { deadline: r.final, step: `截止日：回单日 ${remit} + 5 天推定收到 + 120 天 = ${r.text}（R2）。` };
};
const filingLimit = (through) => rolled(R.filingDeadline(through));
const firstDate = (line) => line.slice(0, 10);
const datesIn = (line) => line.match(/\d{4}-\d{2}-\d{2}/g) ?? [];

const CLAIM_EXPLAIN = {
  "duplicate-paid": (c) => ({
    question: "回单拒付代码 CAS*CO*18。判断：拒付原因、能否挽回、下一步、最后期限。",
    deadline: null,
    steps: [
      "拒付代码 18 = 重复理赔 → 拒付原因 duplicate_claim。",
      `机构记录：原理赔 ${firstDate(c.history[0])} 提交，${firstDate(c.history[1])} 已付款；${c.claim.filed} 又原样提交了一次 → 确实是重复的。`,
      "原理赔已经付过款，重复提交的这笔不用再处理 → 不能挽回（no），下一步核销（write_off），没有期限（R6）。",
    ],
  }),
  "late-filing": (c) => {
    const limit = filingLimit(c.claim.through);
    return {
      question: "回单拒付代码 CAS*CO*29。判断：拒付原因、能否挽回、下一步、最后期限。",
      deadline: null,
      steps: [
        "拒付代码 29 = 超过申报期限 → 拒付原因 timely_filing。",
        `申报期限按结束日期（Through）算一年：Through ${c.claim.through} → 最晚 ${limit.text}（R1）。`,
        `承包商收到日期 ${c.claim.filed}，晚于 ${limit.final} → 确实超期。超期例外（行政错误、追溯资格等）不在本数据集范围，题目也没有提到。`,
        "→ 不能挽回（no），下一步核销（write_off），没有期限。",
      ],
    };
  },
  unprocessable: (c) => {
    const limit = filingLimit(c.claim.through);
    return {
      question: "回单拒付代码 CAS*CO*16，附注 MA130。判断：拒付原因、能否挽回、下一步、最后期限。",
      deadline: limit.final,
      steps: [
        `拒付代码 16 + 附注 MA130 = 信息缺失或无效，理赔不可处理，没有申诉权 → 拒付原因 missing_or_invalid_information（R3）。机构记录里的退回原因：${c.history[1].slice(12).replace(/^Claim edit report: /, "").replace(/\.$/, "")}。`,
        "补齐信息后重新提交即可 → 能挽回（yes），下一步提交新理赔（corrected_claim），不是申诉。",
        `新理赔仍受一年申报期限约束：Through ${c.claim.through} → 截止日 ${limit.text}（R1、R3）。`,
      ],
    };
  },
  "filing-through-date": (c) => {
    const limit = filingLimit(c.claim.through);
    const reopen = R.reopeningDeadline(c.remit.date);
    const also = R.reopeningAlsoAccepted(c.remit.date);
    return {
      question: "回单拒付代码 CAS*CO*29（超期），机构员工认为要核销。判断：拒付原因、能否挽回、下一步、最后期限。",
      deadline: reopen,
      also,
      steps: [
        "拒付代码 29 = 超过申报期限 → 拒付原因 timely_filing。",
        `按开始日期（入院日 ${c.claim.from}）算，收到日期 ${c.claim.filed} 已超过一年；但跨期的机构理赔按结束日期（Through）算（R1，CPM Ch.1 §70.1）：Through ${c.claim.through} → 最晚 ${limit.text}。`,
        `收到日期 ${c.claim.filed} 不晚于 ${limit.final} → 其实没超期，是承包商误拒 → 能挽回（yes）。`,
        "超期判定没有申诉权（42 CFR 405.926(n)），补救办法是请承包商重新开启（reopening），不是申诉（R1）→ 下一步 reopening。",
        `截止日：初始决定（回单日 ${c.remit.date}）后一年 = ${reopen}（${dayNote(reopen)}；405.980(c)(1)）${also.length ? `；这天不是工作日，R7 对 reopening 没有明确出处，所以下一个工作日 ${also.join("、")} 也算对` : ""}。`,
      ],
    };
  },
  "new-benefit-period": (c) => {
    const [priorEnd, hospAdmit] = datesIn(c.history[1]);
    const a = appeal(c.remit.date);
    return {
      question: "回单拒付代码 CAS*PR*119（福利天数用尽）。判断：拒付原因、能否挽回、下一步、最后期限。",
      deadline: a.deadline,
      steps: [
        "拒付代码 119 = 福利上限已用尽 → 拒付原因 benefit_limit_exhausted。",
        `上一段 SNF 住院 ${priorEnd} 结束，那个福利期已用满 100 天；之后到 ${hospAdmit} 住院前，连续 ${R.daysBetween(priorEnd, hospAdmit)} 天没有住院或住 SNF。`,
        `连续 ≥ ${R.BENEFIT_GAP_DAYS} 天不住院，旧福利期结束；${hospAdmit} 住院开始新的福利期，又有 100 天可用（R5）→ 承包商误拒 → 能挽回（yes），下一步申诉（appeal）。`,
        a.step,
      ],
    };
  },
  "benefit-exhausted": (c) => {
    const used = Number(c.history[0].match(/days used in that benefit period: (\d+)/)[1]);
    const priorEnd = datesIn(c.history[0])[1];
    const hospAdmit = c.claim.qualifying.admitOrder;
    return {
      question: "回单拒付代码 CAS*PR*119（福利天数用尽），部分天数已付。判断：拒付原因、能否挽回、下一步、最后期限。",
      deadline: null,
      steps: [
        "拒付代码 119 = 福利上限已用尽 → 拒付原因 benefit_limit_exhausted。",
        `上一段 SNF 住院 ${priorEnd} 结束，已用 ${used} 天；到 ${hospAdmit} 再住院只隔 ${R.daysBetween(priorEnd, hospAdmit)} 天（< ${R.BENEFIT_GAP_DAYS} 天），还在同一个福利期（R5）。`,
        `这个福利期只剩 ${R.SNF_DAYS_PER_PERIOD - used} 天：从 ${c.claim.from} 起算覆盖到 ${c.remit.partial.paidThrough}（回单也写已付到这天），之后到 ${c.claim.through} 的天数确实不在 Medicare 覆盖范围 → 不能挽回（no）。`,
        "机构记录写明没有其他保险（无 Medigap、无 Medicaid）；福利天数用尽时不发 SNFABN（CMS Ch. 30）→ 下一步向患者收费（bill_patient），没有期限。",
      ],
    };
  },
  "qualifying-stay": (c) => {
    const { admitOrder, discharge } = c.claim.qualifying;
    const snfAdmit = c.claim.from;
    const a = appeal(c.remit.date);
    return {
      question: "回单拒付代码 CAS*CO*96，承包商写明「未满足 3 天住院前提」。判断：拒付原因、能否挽回、下一步、最后期限。",
      deadline: a.deadline,
      steps: [
        "承包商给的原因是未满足 3 天住院前提 → 拒付原因 qualifying_stay_not_met。",
        `急诊和观察期不算住院；住院从住院医嘱 ${admitOrder} 算起，算入院当天、不算出院当天：${admitOrder} 到 ${discharge} = ${R.daysBetween(admitOrder, discharge)} 天 ≥ 3 天（R4）。`,
        `出院 ${discharge}，${snfAdmit} 入住本机构，相隔 ${R.daysBetween(discharge, snfAdmit)} 天（≤ 30 天）→ 3 天住院前提满足，承包商误拒 → 能挽回（yes），下一步申诉（appeal）。`,
        a.step,
      ],
    };
  },
};

const CLAIM_NOISE = {
  "date-formats": (v) => {
    const [header, records] = v.split("+");
    return `日期格式混用：表头和回单说明用 ${header}，机构记录用 ${records}（835 段里的日期始终是 CCYYMMDD）`;
  },
  "835-one-line": () => "835 回单的各段连成一行",
  "distractor-records": () => "机构记录里插了几条和规则无关的日常记录",
  "missing-field": (v) => `少了一个次要字段：${{ "total-charges": "总费用", contractor: "承包商名称", mbi: "MBI" }[v]}`,
  ocr: () => "表头标签有类似扫描件的错字（姓名、日期、代码不受影响）",
};
const KYC_NOISE = {
  "date-formats": (v) => `日期换了写法（${{ iso: "如 2026-03-05", "d. monat yyyy": "如 5. März 2026", "d.m.yyyy": "如 5.3.2026" }[v]}）`,
  "amount-formats": (v) => `金额换了写法（${{ "eur-prefix": "如 EUR 12.250,00", euro: "如 12.250,00 €", "dash-cents": "如 12.250,– EUR" }[v]}）`,
  "table-layout": (v) => `股东表格没有对齐（用${{ semicolons: "分号", tabs: "制表符", spaces: "空格" }[v]}分隔）`,
  "distractor-entries": () => "登记摘录里加了和受益所有人无关的条目（经营范围、迁址等）",
  "missing-detail": (v) => `少了一项次要信息：${{ "birth-dates": "出生日期", "list-date": "股东名单日期", "register-numbers": "持股公司的 HRB 号" }[v]}`,
  ocr: () => "标签有类似扫描件的错字（姓名、金额不受影响）",
};
function noiseText(noise, table) {
  if (noise.length === 0) return EN ? NO_NOISE_EN : "无（干净输入）";
  return noise.map((n) => {
    const [type, value] = n.split(/:(.*)/s);
    return table[type](value);
  }).join(EN ? "; " : "；");
}

/** The item's coordinates from its id: cd3-d-qstay-07 → dev, qualifying-stay, index 6. */
function coordinates(id, kinds, shortOf) {
  const [, s, short, n] = id.split("-");
  const archetype = Object.keys(kinds).find((k) => shortOf(kinds[k]) === short);
  return { split: SPLITS[s], archetype, index: Number(n) - 1 };
}

function explainClaims() {
  const task = "claim-denials-snf-v3";
  const out = {};
  for (const split of Object.values(SPLITS)) {
    for (const item of readSplit(task, split)) {
      const at = coordinates(item.id, claimGen.KINDS, (k) => k.short);
      const { item: rebuilt, c } = claimGen.buildCase(setSeedFor(task, claimGen, split, "CLAIM_DENIALS_V3_HOLDOUT_SEED"), at.split, at.archetype, at.index);
      if (!isDeepStrictEqual(rebuilt, item)) throw new Error(`${item.id}: rebuilt item differs from the committed line`);
      const ex = (EN ? CLAIM_EXPLAIN_EN : CLAIM_EXPLAIN)[at.archetype](c);
      if (ex.deadline !== item.expected.deadline) throw new Error(`${item.id}: steps reach deadline ${ex.deadline}, key has ${item.expected.deadline}`);
      if (!isDeepStrictEqual(ex.also ?? [], item.expected.deadline_also_accepted ?? [])) throw new Error(`${item.id}: steps accept ${ex.also}, key ${item.expected.deadline_also_accepted}`);
      out[item.id] = { question: ex.question, steps: ex.steps, noise: noiseText(item.metadata.noise, EN ? CLAIM_NOISE_EN : CLAIM_NOISE) };
    }
  }
  return out;
}

function explainKyc() {
  const task = "kyc-ubo-v3";
  const out = {};
  for (const split of Object.values(SPLITS)) {
    for (const item of readSplit(task, split)) {
      const at = coordinates(item.id, kycGen.KINDS, (k) => k);
      const { item: rebuilt, register, structure } = kycGen.buildCase(setSeedFor(task, kycGen, split, "KYC_UBO_V3_HOLDOUT_SEED"), at.split, at.archetype, at.index);
      if (!isDeepStrictEqual(rebuilt, item)) throw new Error(`${item.id}: rebuilt item differs from the committed line`);
      const { question, steps, counted } = (EN ? explainKycItemEn : explainKycItem)(structure, register);
      const want = item.expected.beneficial_owners.map((o) => o.name).sort();
      if (!isDeepStrictEqual([...counted].sort(), want)) throw new Error(`${item.id}: steps count ${counted.join(", ") || "nobody"}, key has ${want.join(", ") || "nobody"}`);
      if (counted.length === 0 && !steps.at(-1).includes(item.expected.fictitious_beneficial_owners.join(EN ? ", " : "、"))) throw new Error(`${item.id}: fallback step does not name ${item.expected.fictitious_beneficial_owners.join(", ")}`);
      out[item.id] = { question, steps, noise: noiseText(item.metadata.noise, EN ? KYC_NOISE_EN : KYC_NOISE) };
    }
  }
  return out;
}

process.stdout.write(JSON.stringify({ ...explainClaims(), ...explainKyc() }, null, 1));
