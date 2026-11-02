"""Records what an agent did, for agenteval: its tokens and its trace.

It plays the part a LangChain callback handler would: the app calls
`on_llm_end` after every model reply, and nothing else in the app changes.
At the end it leaves two files in the work dir, both read by agenteval:

  .eval-usage.json  the tokens used (`reports_usage: tokens`); agenteval
                    prices them with the candidate's `price`
  .eval-trace.json  every model reply and the tools it called, as ATIF
                    (`trace: atif`); the report's "Agent activity" table

It also enforces the step's spend cap: agenteval hands it over as
EVAL_MAX_COST_USD with the model's price as EVAL_MODEL_PRICE, but cannot stop
an agent mid-run itself.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path


class SpendCapReached(RuntimeError):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TraceRecorder:
    def __init__(self, model: str, instruction: str):
        self.model = model
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.steps = [{"step_id": 1, "source": "user", "timestamp": now(), "message": instruction}]
        self.cap = float(os.environ["EVAL_MAX_COST_USD"]) if os.environ.get("EVAL_MAX_COST_USD") else None
        self.price = json.loads(os.environ.get("EVAL_MODEL_PRICE") or "null")

    def on_llm_end(self, reply: dict) -> None:
        usage = reply["usage"]
        self.prompt_tokens += usage["input_tokens"]
        self.completion_tokens += usage["output_tokens"]
        self.steps.append({
            "step_id": len(self.steps) + 1,
            "source": "agent",
            "timestamp": now(),
            "model_name": reply["model"],
            "message": reply["content"],
            "tool_calls": [
                {"tool_call_id": c["id"], "function_name": c["name"], "arguments": c["args"]} for c in reply["tool_calls"]
            ],
            "metrics": {"prompt_tokens": usage["input_tokens"], "completion_tokens": usage["output_tokens"]},
        })
        spent = self.spent_usd()
        if self.cap is not None and spent is not None and spent > self.cap:
            raise SpendCapReached(f"spent ${spent:.4f}, over this step's cap of ${self.cap}")

    def spent_usd(self) -> float | None:
        if not self.price:
            return None
        return (self.prompt_tokens * self.price["input"] + self.completion_tokens * self.price["output"]) / 1e6

    def write(self, workdir: Path = Path(".")) -> None:
        usage = {"prompt_tokens": self.prompt_tokens, "completion_tokens": self.completion_tokens}
        (workdir / ".eval-usage.json").write_text(json.dumps(usage))
        trace = {
            "schema_version": "ATIF-v1.6",
            "agent": {"name": "agent-pipeline", "version": "1", "model_name": self.model},
            "steps": self.steps,
            "final_metrics": {
                "total_prompt_tokens": self.prompt_tokens,
                "total_completion_tokens": self.completion_tokens,
                "total_steps": len(self.steps),
            },
        }
        (workdir / ".eval-trace.json").write_text(json.dumps(trace, indent=2))
