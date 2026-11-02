"""Run one agent of the app with one model. The only file that knows about agenteval.

    python3 agents/run_stage.py <model>

agenteval runs this in a fresh work dir for every trial, with the question in
`.eval-input.txt`, and says which step this is in EVAL_STEP. One wrapper
serves every step: candidates are declared once per task, so each model's
command is the same on every step, and this file picks the agent.

  search     question -> findings.json
  summarize  question + findings.json -> summary.md
             findings.json is already in the work dir: on its own, the step
             starts from a frozen copy (fixture/summarize/<input>/); in the
             end-to-end chain, from the search step's files (handoff: workdir).

The files left behind are the deliverable the check grades. A non-zero exit
fails the trial.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # leave no __pycache__ beside the task's sources
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # the task dir, where app/ is

from app.agents import search_agent, summarize_agent  # noqa: E402
from app.models import init_chat_model  # noqa: E402
from app.search import CorpusSearch  # noqa: E402
from eval_trace import SpendCapReached, TraceRecorder  # noqa: E402

model_name = sys.argv[1]
step = os.environ.get("EVAL_STEP")
question = Path(".eval-input.txt").read_text().strip()
recorder = TraceRecorder(model_name, question)
model = init_chat_model(model_name)

try:
    if step == "search":
        findings = search_agent(question, model, CorpusSearch(), callbacks=[recorder])
        Path("findings.json").write_text(json.dumps(findings, indent=2) + "\n")
        print(f"findings.json: {len(findings['sources'])} source(s)")
    elif step == "summarize":
        findings = json.loads(Path("findings.json").read_text())
        Path("summary.md").write_text(summarize_agent(question, findings, model, callbacks=[recorder]))
        print("summary.md written")
    else:
        # Exit 2: the setup is wrong, not the candidate.
        print(f"EVAL_STEP is {step!r}; this wrapper runs 'search' or 'summarize'", file=sys.stderr)
        sys.exit(2)
except SpendCapReached as e:
    recorder.write()
    sys.exit(f"stopped: {e}")

recorder.write()
