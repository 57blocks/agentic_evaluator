"""The required check for both stages. Exit 0 passes, 1 fails the candidate.

agenteval runs it in the trial's work dir, where output.txt holds the file the
stage wrote, input.txt is what it was given, and meta.json says which step and
input this was.

  search     every source this question needs was found
  summarize  every bullet cites a passage it was given and says only what
             that passage says, and every passage is used
"""

import json
import re
import sys
from pathlib import Path

NEEDED = {"bikes": ["s1", "s2"], "ferry": ["s3", "s4"]}

meta = json.loads(Path("meta.json").read_text())
output = Path("output.txt").read_text()

if meta["step"] == "search":
    missing = [s for s in NEEDED[meta["input"]] if f"[{s}]" not in output]
    if missing:
        print(f"missed {', '.join(missing)}")
        sys.exit(1)
else:
    passages = dict(re.findall(r"^(\[s\d+\]) (.+)$", Path("input.txt").read_text(), re.M))
    bullets = re.findall(r"^- (.+) (\[s\d+\])$", output, re.M)
    unsupported = [text for text, source in bullets if text not in passages.get(source, "")]
    unused = [s for s in passages if s not in {source for _, source in bullets}]
    if not bullets or unsupported or unused:
        print(f"unsupported: {unsupported}; unused: {unused}")
        sys.exit(1)

print("ok")
