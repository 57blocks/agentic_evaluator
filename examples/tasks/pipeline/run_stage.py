"""The wrapper: runs one stage of my_pipeline with one model. The only file that knows about agenteval.

    python3 run_stage.py <model>

agenteval runs it once per trial, in an empty work dir, with the stage's input
in .eval-input.txt and the step's id in EVAL_STEP. The file it writes is the
stage's output: the check grades it, and in the end-to-end chain it becomes
the next stage's input.
"""

import json
import os
import re
import sys
from pathlib import Path

import my_pipeline


def unwrap(text):
    """In the end-to-end chain, the input is the previous stage's files, each as a
    ```file:<name> block. Take their contents, so the stage gets the same plain
    text it gets when tested on its own."""
    blocks = re.findall(r"^```file:[^\n]*\n(.*?)\n```$", text, re.S | re.M)
    return "".join(blocks) if blocks else text


model = sys.argv[1]
stage = {"search": my_pipeline.search, "summarize": my_pipeline.summarize}[os.environ["EVAL_STEP"]]

Path("result.txt").write_text(stage(unwrap(Path(".eval-input.txt").read_text()), model) + "\n")

# Optional: say what the call cost, so agenteval can compare cost per success.
Path(".eval-usage.json").write_text(json.dumps({"cost_usd": my_pipeline.COST_PER_CALL[model]}))
