# Evaluate your own pipeline

You have an app with several stages, say a search stage and then a summarize stage. You want to know which model should run each stage, and whether mixing models beats using one model everywhere.

This page walks through the sample [`examples/tasks/pipeline`](../examples/tasks/pipeline/spec.yaml), which does exactly that. It has three files worth reading:

| file | what it is |
|---|---|
| [`my_pipeline.py`](../examples/tasks/pipeline/my_pipeline.py) | stands in for your app: `search()` and `summarize()` |
| [`run_stage.py`](../examples/tasks/pipeline/run_stage.py) | the wrapper: runs one stage with one model |
| [`check.py`](../examples/tasks/pipeline/check.py) | decides whether a stage's output passes |

```bash
agenteval run examples/tasks/pipeline --yes --html   # free and offline; needs python3
```

## 1. Make each stage's model a parameter

This is the one change your app may need. If a stage hard-codes its model, nothing can swap it.

```python
def search(question, model): ...
def summarize(passages, model): ...
```

In a LangChain app, the stage would call `init_chat_model(model)` instead of naming a model itself.

## 2. Write a wrapper

agenteval does not import your app. It runs a command, once per trial, in an empty folder. The wrapper is that command: it runs one stage of your app with the model it is given.

```python
model = sys.argv[1]
stage = {"search": my_pipeline.search, "summarize": my_pipeline.summarize}[os.environ["EVAL_STEP"]]
Path("result.txt").write_text(stage(unwrap(Path(".eval-input.txt").read_text()), model))  # unwrap: see step 4
```

| agenteval gives the wrapper | the wrapper gives back |
|---|---|
| `.eval-input.txt`: this stage's input | a file with the stage's output (the check reads it) |
| `EVAL_STEP`: which stage to run | exit code 0 when it ran |
| the model, on the command line you declare | optionally `.eval-usage.json`: what the call cost |

One wrapper covers every stage. Each model is declared once and used on every step, so its command is the same everywhere; `EVAL_STEP` picks the stage.

## 3. Write a check for each stage

A check is any program. It runs in the trial's folder, next to the files the stage wrote (`result.txt` here), with `input.txt` holding what the stage was given and `meta.json` saying which step and input this was. Read the stage's files themselves: `output.txt` is there too, but it wraps every file in a ```` ```file: ```` block. Exit 0 passes, exit 1 fails the candidate; any other exit is counted as the check's own error.

The sample has one check for both stages:

- **search:** were the sources this question needs found?
- **summarize:** does every bullet cite a passage it was given, and say only what that passage says? And is every passage used?

## 4. Write the spec

Each stage is a step, and each model is a candidate:

```yaml
workflow:
  control_candidate: large            # the model you would use on every stage today
  steps:
    - id: search
      test_set: { id: questions, inputs: [bikes, ferry] }
      candidate_ids: [large, mid, small]
      required_checks: [check]
    - id: summarize
      input_from: search              # also run the stages end to end
      test_set: { id: passages, inputs: [bikes-passages, ferry-passages] }
      candidate_ids: [large, mid, small]
      required_checks: [check]

candidates:
  - id: large
    adapter: agent-cli
    cli: { argv: [python3, run_stage.py, large], reports_usage: true }
  # mid and small: the same command, a different model
```

Two things make this work:

- **Each stage has its own inputs.** The summarize step's inputs are saved search results (`inputs/bikes-passages.txt`), so it is tested on good search output whichever model searched. A weak search model cannot make a summarizer look bad.
- **`input_from: search` runs the whole pipeline too.** After testing each stage on its own, agenteval runs search then summarize twice: once with the control model on both, once with each step's pick. Each summarizer then works from the search it was chained to. In that chain, the summarize stage's input is not the search stage's raw text: it is each file search wrote, as a ```` ```file:result.txt ```` block. `run_stage.py` unwraps it (and `check.py` unwraps `input.txt` the same way), so a stage gets the same text whether it runs on its own or in the chain. Do the same in your wrapper, or a stage that parses its input, JSON say, will pass on its own and fail end to end.

The [sample's spec](../examples/tasks/pipeline/spec.yaml) has the rest: the check's declaration, the pass gates, and how each step picks (`lowest-cost`).

## 5. Run it and read the result

```bash
agenteval check-task examples/tasks/pipeline   # free: can the check tell good from bad?
agenteval run examples/tasks/pipeline --yes --html
```

The sample's models have known weaknesses, so the result is predictable:

- **search picks `mid`.** `small` searches only half of each question and is gated out; `mid` passes and costs less than `large`.
- **summarize picks `small`.** `mid` adds a claim no passage supports and is gated out; `small` passes and is the cheapest.
- **The end-to-end run adopts `mid` then `small`** over `large` on both: it passes the same checks at a fraction of the cost.

`report.html` in the run's folder shows each step's pick, why the others were gated out, and the two end-to-end runs side by side.

## When you need more

- **Real models:** pass the model id in `argv`, give the command its API key with `env: { API_KEY: "${API_KEY}" }`, and report tokens instead of a cost so agenteval prices them (`reports_usage: tokens` with `model` or `price`). See [Command candidates](../README.md#command-candidates).
- **Stages that hand over files, not text:** `fixture_dir` and `handoff: workdir`. See [Workflows](../README.md#workflows).
- **Agents:** they vary from run to run, so raise `trials_per_case` to 3 or more; cap each trial with `max_cost_per_trial_usd`; and leave a trace (`trace: atif`) to see their tool calls in the report. See [Command candidates](../README.md#command-candidates).
- **Isolation:** add `image:` to run the wrapper in a container. See [Safety](../README.md#safety).
- **A judge:** add `methods: [pairwise-swap]` to have a model compare outputs where a check cannot see quality. See [Writing a task](../README.md#writing-a-task).
