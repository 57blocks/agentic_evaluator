# Evaluate your own pipeline

You have an application with several stages or agents: a search agent, a
summarizer, a retriever, a router. It might be built on LangGraph or
LangChain, LlamaIndex, or plain SDK calls. The questions are the same:

- Which model should run each agent?
- Is a cheaper model good enough for some of them?
- Does mixing models beat using one model everywhere?

This guide shows how to bring that application to agenteval and answer
those questions with evidence. The free sample
[`examples/tasks/agent-pipeline`](../examples/tasks/agent-pipeline/spec.yaml)
is the runnable version of every step below: a Python search agent and
summarizer agent, three models, one wrapper.

```bash
agenteval run examples/tasks/agent-pipeline --yes --html   # free; needs python3
```

## The shape

agenteval does not import your app, and your app does not import agenteval.
Between them sits one small script, the **wrapper**, which runs one agent
of your app with one model:

```
agenteval        runs every step × candidate × input, grades, picks, runs the chain
   │ runs, once per trial, in a fresh work dir
   ▼
wrapper          agents/run_stage.py <model>: the only file that knows about agenteval
   │ imports
   ▼
your app         unchanged; each agent's model comes from configuration
```

The wrapper can be written in any language. The contract is files and
environment variables:

| direction | what | |
|---|---|---|
| in | `.eval-input.txt` | the input's text (also `{{input}}` in `argv`) |
| in | `EVAL_STEP`, `EVAL_INPUT` | which step and which input this trial is |
| in | files already in the work dir | the input's fixture, or the previous step's files in a chain (`EVAL_CHAINED=1`) |
| out | files left in the work dir | the deliverable the check grades (stdout, if no files) |
| out | exit code | 0: it ran; non-zero: a failed attempt |
| out, optional | `.eval-usage.json` | tokens used, which agenteval prices |
| out, optional | `.eval-trace.json` | what the agent did, as ATIF: turns and tool calls in the report |

Keeping the app out of process is deliberate: agenteval can run the wrapper
in a container, stop it on a timeout, keep the answer keys out of its
reach, and record what it reports about itself as estimated, not measured. See [Command candidates](../README.md#command-candidates)
for every detail of the contract.

## 1. Make each agent's model a setting

This is the one change your app may need. If the model is hard-coded inside
an agent, an evaluation cannot swap it. Pass it in, one per agent:

```python
from langchain.chat_models import init_chat_model

MODELS = {"search": "anthropic:claude-sonnet-5-5", "summarize": "openai:gpt-5.6-mini"}

def answer(question, models=MODELS):
    findings = search_agent(question, init_chat_model(models["search"]))
    return summarize_agent(question, findings, init_chat_model(models["summarize"]))
```

The sample's [`app/pipeline.py`](../examples/tasks/agent-pipeline/app/pipeline.py)
is this, with scripted fake models in place of real ones.

## 2. Write one wrapper for every step

Candidates are declared once per task, and a step lists which of them
compete on it. So each candidate's command is the same on every step, and
one wrapper serves them all: it reads `EVAL_STEP` and runs that agent.

A sketch for a LangChain or LangGraph app (check the callback against your
LangChain version):

```python
# agents/run_stage.py
import json, os, sys
from pathlib import Path
from langchain.chat_models import init_chat_model
from langchain_core.callbacks import UsageMetadataCallbackHandler
from myapp.agents import build_search_agent, build_summarizer   # each returns a runnable

model = init_chat_model(sys.argv[1])
usage = UsageMetadataCallbackHandler()
config = {"callbacks": [usage]}
question = Path(".eval-input.txt").read_text().strip()

step = os.environ["EVAL_STEP"]
if step == "search":
    out = build_search_agent(model).invoke({"question": question}, config)
    Path("findings.json").write_text(json.dumps(out["findings"]))
elif step == "summarize":
    findings = json.loads(Path("findings.json").read_text())   # fixture, or the search step's files
    out = build_summarizer(model).invoke({"question": question, "findings": findings}, config)
    Path("summary.md").write_text(out["summary"])
else:
    sys.exit(2)   # the setup is wrong, not the candidate

# Tokens, for agenteval to price. prompt_tokens excludes cache reads.
calls = list(usage.usage_metadata.values())
cached = sum(c.get("input_token_details", {}).get("cache_read", 0) for c in calls)
Path(".eval-usage.json").write_text(json.dumps({
    "prompt_tokens": sum(c["input_tokens"] for c in calls) - cached,
    "completion_tokens": sum(c["output_tokens"] for c in calls),
    "cache_read_tokens": cached,
}))
```

Each agent writes a file the next one reads (`findings.json`). That
typed handoff is what makes each agent testable on its own: it is the
input you freeze for the next agent, and something a check can read.

If your pipeline is one long chain with no seams, this is where you add
them: an agent the wrapper can invoke with its own input, without running
everything before it.

## 3. One step per agent, with what comes before it frozen

Each agent is a step. Grade it on its own inputs, with everything upstream
of it fixed, so a weak search agent cannot make a good summarizer look bad:

```yaml
workflow:
  control_candidate: large
  steps:
    - id: search
      test_set: { id: questions, inputs: [harbor-line-bikes, airport-at-night, ...] }
      candidate_ids: [large, mid, small]
      required_checks: [search-recall]
    - id: summarize
      input_from: search
      handoff: workdir
      test_set:
        id: findings
        inputs: [harbor-line-bikes, airport-at-night, ...]
        fixture_dir: fixture/summarize     # fixture/summarize/<input>/findings.json
      candidate_ids: [large, mid, small]
      required_checks: [summary-supported]
```

With `fixture_dir`, `fixture/summarize/<input>/` is copied into the work dir
before the summarizer starts: it starts from exactly the findings a good
search run produced. The inputs' text (`inputs/<input>.txt`) is the question,
shared by both steps.

**Record fixtures from real runs** rather than writing them by hand. If your
app uses a LangGraph checkpointer, every node's state is already saved:

```python
for snap in graph.get_state_history({"configurable": {"thread_id": thread}}):
    if snap.next == ("summarize",):           # the state just before summarize ran
        out = Path("fixture/summarize") / case
        out.mkdir(parents=True, exist_ok=True)
        (out / "findings.json").write_text(json.dumps(snap.values["findings"]))
```

Otherwise, log each agent's input and output in production and copy the
interesting cases.

## 4. A check for each agent

A step's required check decides success. It is any program; it runs in the
trial's work dir, beside the candidate's files, `input.txt` and `meta.json`
(`{step, candidate, input, trial}`). Exit 0 passes, 1 fails the candidate,
and anything else is an evaluator error, never blamed on the candidate. An
uncaught Python exception exits 1, so wrap the check's body and exit 2 when
it crashes, as the sample's checks do.

Different agents need different checks:

| agent | a deterministic check | when a judge helps |
|---|---|---|
| search, retrieval | the sources labeled for each input were found (recall); every quote is on the page it cites | relevance beyond the labels |
| summarizer | every claim cites a source it was given, and that source says it; the required facts are present | faithfulness of a paraphrase; clarity |
| extraction, classification | fields equal the answer key | rarely |
| router, supervisor | the route equals the labeled one | rarely |
| the final answer | it states what the answer key requires | overall quality |

Keep the answer key beside the check (`checks/answer_key.json` in the
sample) and put a correct answer for each input in `references/<step>/<input>/`.
`agenteval check-task` then proves, for free, that the check fails an empty
answer and passes the correct one. Add a judge with
`methods: [pairwise-swap]` and a rubric for what a script cannot see; it
informs, and the check decides.

## 5. Make search and other live tools repeatable

Freezing an agent's input is not enough when the agent calls a live tool.
A search agent chooses its own queries, and the web answers differently
from one run to the next, so two candidates would not see the same pages.

Put a record-and-replay layer in front of the tool for the evaluation:
record results by query on real runs, replay them during the evaluation,
and fall back to a small fixed document set for queries never recorded.
Then a difference between candidates is the model's. The sample's search
tool reads a fixed corpus ([`app/search.py`](../examples/tasks/agent-pipeline/app/search.py)).
Run a smaller set against the live tool separately, to catch what replay
hides.

## 6. Candidates: one per model

```yaml
candidates:
  - id: sonnet
    adapter: agent-cli
    model: anthropic/claude-sonnet-5-5           # an OpenRouter id, to price the tokens
    cli:
      argv: [python3, agents/run_stage.py, "anthropic:claude-sonnet-5-5"]
      reports_usage: tokens
      trace: atif
      env: { ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}" }
  - id: in-house
    adapter: agent-cli
    price: { input: 0.4, output: 1.6 }           # USD per million tokens, for a model OpenRouter does not list
    cli:
      argv: [python3, agents/run_stage.py, "openai:my-finetune"]
      reports_usage: tokens
x-harness: { producer: codegen }                 # required for command candidates: their files are the deliverable
```

`${NAME}` in `env` is read from your environment (or `.env.local`) when the
command starts, so the key never lands in the spec or the run's records.
On this machine the command also inherits your whole environment; in a
container (`image:`, see [Safety](../README.md#safety)) only the variables
you list cross over.

## 7. The chain: does the combination hold up?

`input_from: search` chains the steps. After evaluating each step on its
own, agenteval runs the whole pipeline twice on the first step's inputs:

- **control**: `control_candidate` on every step, usually the model you use
  today, or the one you would pick if you picked one;
- **proposed**: each step's recommended candidate.

`handoff: workdir` starts each chained step from the files the previous one
left, with the original question as its input: the summarizer reads the
`findings.json` the search agent just wrote, instead of a fixture. Without
it, the previous step's output is the next step's input text.

The verdict is `adopt-combination`, `keep-control` or `not-validated`. With
`operating_mode: lowest-cost`, a combination is adopted only when it saves
at least `execution.minimum_meaningful_difference` (USD per success) and
passes the same gates. Declare the saving that would make switching worth
it before you run.

## 8. What changes because they are agents

- **Run more trials.** Agents take different paths each run. Use
  `trials_per_case: 3` or more, and add `minimum_all_trials_pass_rate` where
  one wrong answer in k is a wrong answer.
- **Cap each trial.** `max_cost_per_trial_usd` and
  `maximum_completion_time_seconds` per step. agenteval stops a trial that
  runs out of time; spend it cannot see, so it hands the cap to the wrapper
  (`EVAL_MAX_COST_USD`, with the price as `EVAL_MODEL_PRICE`) to enforce.
- **Leave a trace.** How an agent worked explains why one model won:
  fewer turns, fewer tool calls, a loop. Write `.eval-trace.json` as ATIF and
  declare `trace: atif`; the report gains an "Agent activity" table. The
  sample's [`agents/eval_trace.py`](../examples/tasks/agent-pipeline/agents/eval_trace.py)
  is a callback that does it: one agent step per model reply, with its tool
  calls and tokens.
- **Test the router on its own.** If a supervisor decides which agents run,
  grade its routing as a step (input: a request; check: the labeled route),
  and let the chain show whether the agents' picks hold up together.

## 9. Run it

```bash
agenteval check-task my-pipeline     # free: inputs, checks against references, candidates
agenteval plan my-pipeline           # free: how many trials, and the budget ceiling
agenteval run my-pipeline --yes --html
```

Start with one step and a few inputs, read what the check says about each
trial, then add steps. The report opens on the workflow: each step's pick
and why the others were gated, the two arms of the chain side by side, and
what the run could not observe (`GAPS.md`).

## Coming from Harbor?

[Harbor](https://harborframework.com) integrates an agent with an adapter
class that runs it inside the task's container, and grades one agent on one
task, or on a sequence of instructions with one model. agenteval's wrapper
plays the adapter's part, as a command; the difference is the question
asked: which model for each stage, and whether the mix beats one model. The
two fit together: a Harbor job can be a candidate (`tasks/harbor-spike`) or
be imported whole (`agenteval import-harbor`), and both read ATIF traces.
