#!/usr/bin/env node
/**
 * Replays the claim-denials-snf-v2 and kyc-ubo-v2 generators (same seed, same
 * order) and writes, for every item, what the item asks and how the answer key
 * follows from the rules, as Chinese steps a domain reviewer can check one by
 * one. Prints JSON: { "<id>": { question, steps: [..] } }.
 *
 * It fails if a replayed input or answer differs from the committed files, or
 * if the people the steps count as owners differ from the key: the steps then
 * describe a different item than the reviewer sees.
 *
 *   node datasets/review/build/explain.mjs > derivations.json
 */

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const TASKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tasks");
const CLAIM = `${TASKS}/claim-denials-snf-v2`;
const KYC = `${TASKS}/kyc-ubo-v2`;

const { ARCHETYPES: CLAIM_ARCHETYPES, QUOTA: CLAIM_QUOTA } = await import(`${CLAIM}/gen/structures.mjs`);
const { render: renderClaim } = await import(`${CLAIM}/gen/render.mjs`);
const { filingDeadline, redeterminationDeadline, daysBetween, BENEFIT_GAP_DAYS, SNF_DAYS_PER_PERIOD } = await import(`${CLAIM}/gen/rules.mjs`);
const { QUOTA: KYC_QUOTA, buildStructure } = await import(`${KYC}/gen/structures.mjs`);
const { nameSource, render: renderKyc } = await import(`${KYC}/gen/render.mjs`);
const { controls, naturalPersons } = await import(`${KYC}/gen/solve.mjs`);

// Must match both generate.mjs files.
const CLAIM_SEED = 20261016;
const KYC_SEED = 20261015;
const EXTRA_PASSES = 9;

/** mulberry32, as in generate.mjs. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const passes = (quota) => Array.from({ length: 1 + EXTRA_PASSES }, () => Object.entries(quota)).flat();
const read = (file) => fs.readFileSync(file, "utf8").trim();

function assertSame(id, task, input, expected) {
  if (input !== read(`${task}/inputs/${id}.txt`)) throw new Error(`${id}: replayed input differs from inputs/${id}.txt`);
  if (!isDeepStrictEqual(expected, JSON.parse(read(`${task}/references/${id}.txt`)))) throw new Error(`${id}: replayed answer differs from references/${id}.txt`);
}

// ---------- claim-denials ----------

const firstDate = (line) => line.slice(0, 10);
const datesIn = (line) => line.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
const appealDeadline = (remit) => `截止日：回单日 ${remit} + 5 天推定收到 + 120 天 = ${redeterminationDeadline(remit)}（R2）`;

const CLAIM_EXPLAIN = {
  "duplicate-paid": (c) => ({
    question: "回单拒付代码 CAS*CO*18。判断：拒付原因、能否挽回、下一步、最后期限。",
    steps: [
      "拒付代码 18 = 重复理赔 → 拒付原因 duplicate_claim。",
      `机构记录：原理赔 ${firstDate(c.history[0])} 提交，${firstDate(c.history[1])} 已付款；${c.claim.filed} 又原样提交了一次 → 确实是重复的。`,
      "原理赔已经付过款，重复提交的这笔不用再处理 → 不能挽回（no），下一步核销（write_off），没有期限（R6）。",
    ],
  }),
  "late-filing": (c) => ({
    question: "回单拒付代码 CAS*CO*29。判断：拒付原因、能否挽回、下一步、最后期限。",
    steps: [
      "拒付代码 29 = 超过申报期限 → 拒付原因 timely_filing。",
      `申报期限按结束日期（Through）算一年：Through ${c.claim.through} → 最晚 ${filingDeadline(c.claim.through)}（R1）。`,
      `承包商收到日期 ${c.claim.filed}，晚于 ${filingDeadline(c.claim.through)} → 确实超期。超期例外（行政错误、追溯资格等）不在本数据集范围，题目也没有提到。`,
      "→ 不能挽回（no），下一步核销（write_off），没有期限。",
    ],
  }),
  unprocessable: (c) => ({
    question: "回单拒付代码 CAS*CO*16，附注 MA130。判断：拒付原因、能否挽回、下一步、最后期限。",
    steps: [
      `拒付代码 16 + 附注 MA130 = 信息缺失或无效，理赔不可处理，没有申诉权 → 拒付原因 missing_or_invalid_information（R3）。机构记录里的退回原因：${c.history[1].slice(12).replace(/^Claim edit report: /, "").replace(/\.$/, "")}。`,
      "补齐信息后重新提交即可 → 能挽回（yes），下一步提交新理赔（corrected_claim），不是申诉。",
      `新理赔仍受一年申报期限约束：Through ${c.claim.through} → 截止日 ${filingDeadline(c.claim.through)}（R1、R3）。`,
    ],
  }),
  "filing-through-date": (c) => ({
    question: "回单拒付代码 CAS*CO*29（超期），机构员工认为要核销。判断：拒付原因、能否挽回、下一步、最后期限。",
    steps: [
      "拒付代码 29 = 超过申报期限 → 拒付原因 timely_filing。",
      `按开始日期（入院日 ${c.claim.from}）算，收到日期 ${c.claim.filed} 已超过一年；但跨期的机构理赔按结束日期（Through）算（R1，CPM Ch.1 §70.1）：Through ${c.claim.through} → 最晚 ${filingDeadline(c.claim.through)}。`,
      `收到日期 ${c.claim.filed} 不晚于 ${filingDeadline(c.claim.through)} → 其实没超期，是承包商误拒 → 能挽回（yes）。`,
      "按 R1，承包商误拒的超期拒付走申诉 → 下一步 appeal（申请 redetermination）。",
      appealDeadline(c.remit.date),
    ],
  }),
  "new-benefit-period": (c) => {
    const [priorEnd, hospAdmit] = datesIn(c.history[1]);
    return {
      question: "回单拒付代码 CAS*PR*119（福利天数用尽）。判断：拒付原因、能否挽回、下一步、最后期限。",
      steps: [
        "拒付代码 119 = 福利上限已用尽 → 拒付原因 benefit_limit_exhausted。",
        `上一段 SNF 住院 ${priorEnd} 结束，那个福利期已用满 100 天；之后到 ${hospAdmit} 住院前，连续 ${daysBetween(priorEnd, hospAdmit)} 天没有住院或住 SNF。`,
        `连续 ≥ ${BENEFIT_GAP_DAYS} 天不住院，旧福利期结束；${hospAdmit} 住院开始新的福利期，又有 100 天可用（R5）→ 承包商误拒 → 能挽回（yes），下一步申诉（appeal）。`,
        appealDeadline(c.remit.date),
      ],
    };
  },
  "benefit-exhausted": (c) => {
    const used = Number(c.history[0].match(/days used in that benefit period: (\d+)/)[1]);
    const priorEnd = datesIn(c.history[0])[1];
    const hospAdmit = c.claim.qualifying.admitOrder;
    return {
      question: "回单拒付代码 CAS*PR*119（福利天数用尽），部分天数已付。判断：拒付原因、能否挽回、下一步、最后期限。",
      steps: [
        "拒付代码 119 = 福利上限已用尽 → 拒付原因 benefit_limit_exhausted。",
        `上一段 SNF 住院 ${priorEnd} 结束，已用 ${used} 天；到 ${hospAdmit} 再住院只隔 ${daysBetween(priorEnd, hospAdmit)} 天（< ${BENEFIT_GAP_DAYS} 天），还在同一个福利期（R5）。`,
        `这个福利期只剩 ${SNF_DAYS_PER_PERIOD - used} 天：从 ${c.claim.from} 起算覆盖到 ${c.remit.partial.paidThrough}（回单也写已付到这天），之后到 ${c.claim.through} 的天数确实不在 Medicare 覆盖范围 → 不能挽回（no）。`,
        "机构记录写明没有其他保险（无 Medigap、无 Medicaid）→ 下一步向患者收费（bill_patient），没有期限。",
      ],
    };
  },
  "qualifying-stay": (c) => {
    const { admitOrder, discharge } = c.claim.qualifying;
    const snfAdmit = c.claim.from;
    return {
      question: "回单拒付代码 CAS*CO*96，承包商写明「未满足 3 天住院前提」。判断：拒付原因、能否挽回、下一步、最后期限。",
      steps: [
        "承包商给的原因是未满足 3 天住院前提 → 拒付原因 qualifying_stay_not_met。",
        `急诊和观察期不算住院；住院从住院医嘱 ${admitOrder} 算起，算入院当天、不算出院当天：${admitOrder} 到 ${discharge} = ${daysBetween(admitOrder, discharge)} 天 ≥ 3 天（R4）。`,
        `出院 ${discharge}，${snfAdmit} 入住本机构，相隔 ${daysBetween(discharge, snfAdmit)} 天（≤ 30 天）→ 3 天住院前提满足，承包商误拒 → 能挽回（yes），下一步申诉（appeal）。`,
        appealDeadline(c.remit.date),
      ],
    };
  },
};

function explainClaims() {
  const rng = seeded(CLAIM_SEED);
  const out = {};
  let n = 0;
  for (const [archetype, count] of passes(CLAIM_QUOTA)) {
    for (let k = 0; k < count; k++) {
      const id = `cd2-${String(++n).padStart(3, "0")}`;
      const c = { ...CLAIM_ARCHETYPES[archetype].build(rng), claimNo: String(80000 + Math.floor(rng() * 19999)) };
      assertSame(id, CLAIM, renderClaim(rng, c), c.expected);
      out[id] = CLAIM_EXPLAIN[archetype](c);
    }
  }
  return out;
}

// ---------- kyc-ubo-v2 ----------

const eur = (n) => `${n.toLocaleString("de-DE")} €`;
const pct = (part, base) => `${((part / base) * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
const votes = (h) => (h.voting === false ? 0 : h.nominal);
const total = (list, f = (h) => h.nominal) => list.reduce((s, h) => s + f(h), 0);
const overQuarter = (part, base) => base > 0 && part * 4 > base;

/** Who, if anyone, controls `name`, with each natural holder's vote share in it. */
function describeEntity(name, entities) {
  const e = entities[name];
  const base = total(e.holders, votes);
  const shares = e.holders.map((h) => `${h.holder} ${pct(votes(h), base)}`).join("、");
  const persons = [...new Set(e.holders.filter((h) => h.person).map((h) => h.holder))];
  const controller = persons.find((p) => controls(p, name, entities));
  return controller
    ? `${name} 的表决权：${shares} → ${controller} 超过 50%，控制 ${name}（R5）。`
    : `${name} 的表决权：${shares} → 没有人超过 50%，无人控制，它持有的份额不算到任何人头上（R5）。`;
}

function personLine(person, target, entities) {
  const t = entities[target];
  const direct = t.holders.filter((h) => h.person && h.holder === person);
  const via = t.holders.filter((h) => !h.person && controls(person, h.holder, entities, new Set([target])));
  const capBase = total(t.holders);
  const voteBase = total(t.holders, votes);
  const cap = total(direct) + total(via);
  const vote = total(direct, votes) + total(via, votes);
  const parts = [
    ...(direct.length ? [`直接持有 ${eur(total(direct))}${direct.length > 1 ? `（${direct.length} 笔合计，R2）` : ""}`] : []),
    ...via.map((h) => `经其控制的 ${h.holder} 计入 ${eur(h.nominal)}（全额，R3${via.length > 1 ? "、R4" : ""}）`),
  ];
  const gp = t.generalPartner && controls(person, t.generalPartner, entities);
  if (parts.length === 0 && !gp) return `${person}：在 ${target} 没有可算到其名下的份额 → 不算。`;
  const capText = parts.length ? `${parts.join("；")}；资本 ${eur(cap)} / ${eur(capBase)} = ${pct(cap, capBase)}` : "不直接持有份额";
  const voteText = parts.length && vote !== cap || parts.length && voteBase !== capBase ? `；表决权（按有表决权的出资）${eur(vote)} / ${eur(voteBase)} = ${pct(vote, voteBase)}` : "";
  const verdict = overQuarter(cap, capBase)
    ? "资本超过 25% → 算（R1）"
    : parts.length && overQuarter(vote, voteBase)
      ? "表决权超过 25% → 算（R1）"
      : gp
        ? `控制普通合伙人 ${t.generalPartner} → 算（R7）`
        : "资本和表决权都不超过 25% → 不算";
  return `${person}：${capText}${voteText} → ${verdict}。`;
}

function explainKycItem(structure, register) {
  const { target, entities, legalReps } = structure;
  const t = entities[target];
  const steps = [];
  if (t.ownShares) steps.push(`${target} 持有自己的份额 ${eur(t.ownShares)}，不计入基数：资本基数 = ${eur(t.capital)} − ${eur(t.ownShares)} = ${eur(total(t.holders))}（R6）。`);
  if (t.holders.some((h) => h.voting === false)) {
    const mute = t.holders.filter((h) => h.voting === false).map((h) => `${h.holder} ${eur(h.nominal)}`).join("、");
    steps.push(`无表决权的份额：${mute}；表决权基数（有表决权的出资）= ${eur(total(t.holders, votes))}。资本或表决权任一超过 25% 都算（R1）。`);
  }
  for (const name of Object.keys(entities).filter((n) => n !== target)) steps.push(describeEntity(name, entities));
  const lines = naturalPersons(entities).map((p) => ({ p, line: personLine(p, target, entities) }));
  steps.push(...lines.map((x) => x.line));
  const counted = lines.filter((x) => x.line.endsWith("→ 算（R1）。") || x.line.endsWith("→ 算（R7）。")).map((x) => x.p);
  if (counted.length === 0) {
    const reps = register.kg ? legalReps.join("、") : register.managers.join("、");
    const prokura = register.prokura.length ? `；Prokurist ${register.prokura.join("、")} 不是法定代表人，不算` : "";
    steps.push(`没有人达标 → 受益所有人为空；虚拟受益所有人 = 法定代表人（Geschäftsführer）：${reps}${prokura}（R8）。`);
  } else {
    steps.push(`→ 受益所有人：${counted.join("、")}；有人达标，虚拟受益所有人为空。`);
  }
  return { question: `找出 ${target} 的受益所有人（直接或间接持有超过 25% 的资本或表决权，或以其他方式控制）；没有人达标时，给出虚拟受益所有人。`, steps, counted };
}

function explainKyc() {
  const rng = seeded(KYC_SEED);
  const out = {};
  let n = 0;
  for (const [archetype, count] of passes(KYC_QUOTA)) {
    for (let k = 0; k < count; k++) {
      const id = `ubo2-${String(++n).padStart(3, "0")}`;
      const { structure, register } = buildStructure(rng, nameSource(rng), archetype);
      const expected = JSON.parse(read(`${KYC}/references/${id}.txt`));
      if (renderKyc(rng, structure, register) !== read(`${KYC}/inputs/${id}.txt`)) throw new Error(`${id}: replayed input differs from inputs/${id}.txt`);
      const { question, steps, counted } = explainKycItem(structure, register);
      const want = expected.beneficial_owners.map((o) => o.name).sort();
      if (!isDeepStrictEqual([...counted].sort(), want)) throw new Error(`${id}: steps count ${counted.join(", ") || "nobody"}, key has ${want.join(", ") || "nobody"}`);
      if (counted.length === 0 && !steps.at(-1).includes(expected.fictitious_beneficial_owners.join("、"))) throw new Error(`${id}: fallback step does not name ${expected.fictitious_beneficial_owners.join(", ")}`);
      out[id] = { question, steps };
    }
  }
  return out;
}

process.stdout.write(JSON.stringify({ ...explainClaims(), ...explainKyc() }, null, 1));
