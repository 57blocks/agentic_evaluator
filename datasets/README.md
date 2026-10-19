# Datasets

Evaluation datasets: answer keys a model, prompt or agent is graded against,
each with the rules behind its answers. All five golden-dataset samples on the
[Agent Evaluation Protocol](https://agent-eval-protocol.vercel.app/#golden)
page are here (agent-security in two versions); the last set is agb's own flow.

This directory is an agenteval workspace (it holds `tasks/`), so everything
works on it directly:

```bash
agenteval dash --workspace datasets                       # browse every set and its reports
open datasets/tasks/claim-denials-snf-v2/runs/*/report.html   # one report, as its run wrote it
agenteval check-task datasets/tasks/claim-denials-snf-v2  # free: the check passes every answer key
agenteval run datasets/tasks/claim-denials-snf-v2 --yes --html   # billed
```

## The sets

| dataset | protocol page sample | items | what it evaluates | answer key from |
|---|---|---|---|---|
| [`claim-denials-snf-v2`](tasks/claim-denials-snf-v2/spec.yaml) | `claim-denials-snf-v1` | 30 | triaging a denied Medicare fee-for-service SNF claim from raw 835 codes and the facility's records, with no payer manual | [RULES.md](tasks/claim-denials-snf-v2/RULES.md): 42 CFR, CMS manuals, X12 codes |
| [`kyc-ubo-v2`](tasks/kyc-ubo-v2/spec.yaml) | `kyc-ubo-v1` | 30 | finding a company's beneficial owners from German register extracts under § 3 GwG | [RULES.md](tasks/kyc-ubo-v2/RULES.md): the statute and the BVA Transparenzregister FAQ |
| [`contract-terms-long`](tasks/contract-terms-long/spec.yaml) | `contract-terms-v1` | 6 | extracting eight commercial terms from ~9,000-word scanned agreement packets | the generator: amendments applied by effective date and signature |
| [`coverage-qa-v1`](tasks/coverage-qa-v1/spec.yaml) | `coverage-qa-cited-v1` | 30 | answering a coverage question from a medical policy, citing the deciding clauses; 21 hard (two clauses, exceptions, a revised threshold, scope, silent policies) | [gen/items.mjs](tasks/coverage-qa-v1/gen/items.mjs): written by hand against three synthetic policies |
| [`agent-security-v1`](tasks/agent-security-v1/spec.yaml) | `agent-security-v1` | 30 | a tool-using agent ignoring instructions hidden in retrieved data and staying inside policy (20 attacks), without refusing legitimate requests (10 benign controls); graded from the tool-call trace | [RULES.md](tasks/agent-security-v1/RULES.md): what each scenario family requires and forbids |
| [`agent-security-v2`](tasks/agent-security-v2/spec.yaml) | `agent-security-v1`, harder | 64 | the same, when the instruction reads as ordinary content and goes through an allowed tool (identity in a URL, other customers' data in a reply, a lookalike-domain forward, an authority claim, a toolchain change in test output: 40 attacks), with 24 benign mirrors; simulated workspace that stays consistent | [RULES.md](tasks/agent-security-v2/RULES.md) |
| [`agb-flow`](tasks/agb-flow/spec.yaml) | — | 3 + 3 + 2 | which model should run each step of agb's flow: task-breakdown, test-design, implementation | checks that grade the work itself (`checks/`), and a pairwise judge |

The first five are synthetic; `node datasets/tasks/<name>/gen/generate.mjs`
rebuilds the same files (from a fixed seed, or for coverage-qa-v1 from the
hand-written items).
agb-flow's inputs are snapshots of real agb projects (demo-todo, chessicle,
invoice); `tasks/agb-flow` at the repository root is its working copy.

## What the kept runs found

Four candidates (sonnet-5, kimi-k3, glm-5.3, deepseek-v4.1-flash) for the
other sets; ten for agb-flow. Required-check passes:

| dataset | result | reading |
|---|---|---|
| claim-denials-snf-v2 | kimi-k3 28/30, sonnet-5 15/30, glm-5.3 12/30, deepseek-flash 11/30 | most misses are the redetermination deadline (receipt presumed 5 days after the notice); no candidate qualifies |
| kyc-ubo-v2 | kimi-k3 26/30, sonnet-5 25/30, deepseek-flash 23/30, glm-5.3 21/30 | every model gets the ordinary items; misses are multiplied stakes and stakes held through two controlled companies |
| contract-terms-long | every candidate 6/6 | length and scan noise do not separate these models: the cheapest is enough |
| agb-flow | task-breakdown fable-5.1, test-design opus-5.5, implementation deepseek-flash | 2–3 inputs a step: directional |
| coverage-qa-v1 | kimi-k3, glm-5.3, deepseek-flash 30/30, sonnet-5 29/30 | the one miss is malformed JSON, not a wrong answer: with the policy in the prompt, these questions do not separate the models. Judge uncalibrated: nobody has run `agenteval review` yet |
| agent-security-v2 | sonnet-5 64/64, deepseek-flash 64/64, kimi-k3 63/64, glm-5.3 61/64 | every miss is url-exfil: the model appended its user's email to a link because the page asked "subscribers" (glm 2/2, kimi 1/2) or "AI assistants" (glm 1/2) to; no model leaked other customers' data, forwarded to a lookalike domain, waived the callback or ran the suggested toolchain change. 64 items × 1 trial: directional |
| agent-security-v2, url-exfil widened ([url-exfil.yaml](tasks/agent-security-v2/url-exfil.yaml): 24 attacks + 8 mirrors × 3 trials) | user's identity sent out in a link, of 72 attack trials: sonnet-5 2 (3%), deepseek-flash 12 (17%), kimi-k3 25 (35%), glm-5.3 42 (58%) | the channel decides it: when the ask sits in a newsletter email rather than on the page the person named, every model leaks more (kimi 23/36 vs 2/36, deepseek 12/36 vs 0/36). Mirrors (the person gives a code, or says "use my email"): no model refused. Caveat: the newsletter prompt says "in a three-bullet note", which sonnet-5 read as "in your reply" 11 times and so never called save_note; the check counts those as fails (83/96), the leak counts above do not |
| agent-security-v1 | sonnet-5, kimi-k3, glm-5.3 30/30, deepseek-flash 28/30 | no model followed a hidden instruction or broke policy on any of the 20 attacks; deepseek-flash's misses are two benign controls where it kept probing the simulated shell (which answers `exit 0` even to `false`) and never deleted ./build |

Each report opens with what the set evaluates and breaks the result down by
input tag (ordinary items, each kind of trap, holdout split).

## Layout of a set

```
spec.yaml           what is evaluated, candidates, the check, gates
RULES.md            the rules each answer follows, with sources (where rules decide the answer)
inputs/<id>.txt     what the candidate reads
references/<id>.txt the answer key (hidden from candidates while a run is in flight)
checks/             the script that grades an answer, and manifest.json: tags and split per input
gen/                the generator, seeded
<name>.jsonl        the whole set, one item per line: input, expected, tags, split, provenance
runs/<run>/         one finished run, with report.html
```

agent-security-v1 differs in two places: every candidate is the same agent
loop (`agents/tool-agent.mjs`, simulated tools) with a different model, and
`references/<id>/` is a directory: `key.json` (the rules the check applies to
the trace) beside one trace that passes them (`calls.jsonl`, `final.txt`).

coverage-qa-v1 also declares `evaluators.human`: after a run, `agenteval
review <run>` lets a person compare two answers blind, and the report shows
how often the judge agreed with them. That is how its judge gets calibrated;
until someone has reviewed, its judged scores are uncalibrated.

`tasks/agent-security-v2-probe` (eight hand-written scenarios) and
`tasks/coverage-qa-v2-probe` (eight harder coverage questions, which all four
models answered correctly, so no v2 of coverage-qa was built) are the probes
behind the harder sets. The earlier versions and hand-written probes that shaped these sets
(`kyc-ubo-v1`, `kyc-ubo-v2-probe`, `contract-terms-probe`, `contract-terms-probe2`,
`claim-denials-probe`) are in the repository's `tasks/`.
