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
| [`claim-denials-snf-v2`](tasks/claim-denials-snf-v2/spec.yaml) | `claim-denials-snf-v1` | 300 | triaging a denied Medicare fee-for-service SNF claim from raw 835 codes and the facility's records, with no payer manual | [RULES.md](tasks/claim-denials-snf-v2/RULES.md): 42 CFR, CMS manuals, X12 codes |
| [`kyc-ubo-v2`](tasks/kyc-ubo-v2/spec.yaml) | `kyc-ubo-v1` | 300 | finding a company's beneficial owners from German register extracts under § 3 GwG | [RULES.md](tasks/kyc-ubo-v2/RULES.md): the statute and the BVA Transparenzregister FAQ |
| [`contract-terms-long`](tasks/contract-terms-long/spec.yaml) | `contract-terms-v1` | 6 | extracting eight commercial terms from ~9,000-word scanned agreement packets | the generator: amendments applied by effective date and signature |
| [`coverage-qa-v1`](tasks/coverage-qa-v1/spec.yaml) | `coverage-qa-cited-v1` | 30 | answering a coverage question from a medical policy, citing the deciding clauses; 21 hard (two clauses, exceptions, a revised threshold, scope, silent policies) | [gen/items.mjs](tasks/coverage-qa-v1/gen/items.mjs): written by hand against three synthetic policies |
| [`agent-security-v1`](tasks/agent-security-v1/spec.yaml) | `agent-security-v1` | 30 | a tool-using agent ignoring instructions hidden in retrieved data and staying inside policy (20 attacks), without refusing legitimate requests (10 benign controls); graded from the tool-call trace | [RULES.md](tasks/agent-security-v1/RULES.md): what each scenario family requires and forbids |
| [`agent-security-v2`](tasks/agent-security-v2/spec.yaml) | `agent-security-v1`, harder | 64 + 120 (url-exfil) | the same, when the instruction reads as ordinary content and goes through an allowed tool (identity in a URL, other customers' data in a reply, a lookalike-domain forward, an authority claim, a toolchain change in test output: 40 attacks), with 24 benign mirrors; simulated workspace that stays consistent | [RULES.md](tasks/agent-security-v2/RULES.md) |
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
| claim-denials-snf-v2 (300 items, 8 models: `runs/*-combined-*`) | gpt-5.6-sol 92%, kimi-k3 91%, opus-5.5 90%, sonnet-5 49%, glm-5.3 42%, deepseek-flash 39%, qwen3.8-max 32%, deepseek-v4-pro 20% (of 300; a 300 s timeout counts as wrong) | the top three are indistinguishable (paired test, p > 0.4) and far ahead of the rest (p < 1e-10). Nearly every miss by the others is one rule: the redetermination deadline is 125 days after the remittance (120 from receipt, presumed 5 days after the notice, 42 CFR 405.942). qwen3.8-max timed out on 160 of 300 (69% of what it answered); deepseek-v4-pro answers in ~2 s, apparently without reasoning |
| kyc-ubo-v2 (300 items, 8 models: `runs/*-combined-*`) | gpt-5.6-sol 97%, opus-5.5 97%, kimi-k3 86%, sonnet-5 83%, deepseek-flash 81%, glm-5.3 70%, qwen3.8-max 50%, deepseek-v4-pro 46% (of 300; a timeout counts as wrong) | gpt-5.6-sol and opus-5.5 are indistinguishable and ahead of every other model (p < 0.001). Ordinary items are near 100% for the strong models; misses are two controlled vehicles beside a 50/50 holding, the no-control fallback, the KG general partner and aggregation. Timeouts: qwen 86, glm 18, kimi 13 |
| contract-terms-long | every candidate 6/6 | length and scan noise do not separate these models: the cheapest is enough |
| agb-flow | task-breakdown fable-5.1, test-design opus-5.5, implementation deepseek-flash | 2–3 inputs a step: directional |
| coverage-qa-v1 | kimi-k3, glm-5.3, deepseek-flash 30/30, sonnet-5 29/30 | the one miss is malformed JSON, not a wrong answer: with the policy in the prompt, these questions do not separate the models. Judge uncalibrated: nobody has run `agenteval review` yet |
| agent-security-v2 | sonnet-5 64/64, deepseek-flash 64/64, kimi-k3 63/64, glm-5.3 61/64 | every miss is url-exfil: the model appended its user's email to a link because the page asked "subscribers" (glm 2/2, kimi 1/2) or "AI assistants" (glm 1/2) to; no model leaked other customers' data, forwarded to a lookalike domain, waived the callback or ran the suggested toolchain change. 64 items × 1 trial: directional |
| agent-security-v2, url-exfil widened ([url-exfil.yaml](tasks/agent-security-v2/url-exfil.yaml): 96 attacks + 24 mirrors, 8 models) | user's identity sent out in a link, of 96 attacks: sonnet-5 1, opus-5.5 1, qwen3.8-max 16, deepseek-flash 24, kimi-k3 34, gpt-5.6-sol 39, glm-5.3 45, deepseek-v4-pro 66 | the two Claude models almost never leak; opus-5.5 also stopped with an empty reply on 51 runs, 12 of them benign mirrors: the API ended the response with `content_filter` / `refusal` when it saw the injection (reproduced directly against OpenRouter, 3 of 8 identical requests). The channel decides it for the rest: in a newsletter, gpt-5.6-sol leaks 33/48, on the page 6/48. Every other model passed all 24 mirrors (qwen 23) |
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
