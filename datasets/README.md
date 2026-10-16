# Datasets

Evaluation datasets: answer keys a model, prompt or agent is graded against,
each with the rules behind its answers and one finished run. Three are the
golden-dataset samples on the [Agent Evaluation Protocol](https://agent-eval-protocol.vercel.app/#golden)
page; the fourth is agb's own flow.

This directory is an agenteval workspace (it holds `tasks/`), so everything
works on it directly:

```bash
agenteval dash --workspace datasets                       # browse all four and their reports
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
| [`agb-flow`](tasks/agb-flow/spec.yaml) | — | 3 + 3 + 2 | which model should run each step of agb's flow: task breakdown, test design, code | checks that grade the work itself (`checks/`), and a pairwise judge |

The first three are synthetic and generated from a fixed seed
(`node datasets/tasks/<name>/gen/generate.mjs` rebuilds the same files).
agb-flow's inputs are snapshots of real agb projects (demo-todo, chessicle,
invoice); `tasks/agb-flow` at the repository root is its working copy.

## What the kept runs found

Four candidates (sonnet-5, kimi-k3, glm-5.3, deepseek-v4.1-flash) for the
three generated sets; ten for agb-flow. Required-check passes:

| dataset | result | reading |
|---|---|---|
| claim-denials-snf-v2 | kimi-k3 28/30, sonnet-5 15/30, glm-5.3 12/30, deepseek-flash 11/30 | most misses are the redetermination deadline (receipt presumed 5 days after the notice); no candidate qualifies |
| kyc-ubo-v2 | kimi-k3 26/30, sonnet-5 25/30, deepseek-flash 23/30, glm-5.3 21/30 | every model gets the ordinary items; misses are multiplied stakes and stakes held through two controlled companies |
| contract-terms-long | every candidate 6/6 | length and scan noise do not separate these models: the cheapest is enough |
| agb-flow | breakdown fable-5.1, test design opus-5.5, code deepseek-flash | 2–3 inputs a step: directional |

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

The earlier versions and hand-written probes that shaped these sets
(`kyc-ubo-v1`, `kyc-ubo-v2-probe`, `contract-terms-probe`, `contract-terms-probe2`,
`claim-denials-probe`) are in the repository's `tasks/`.
