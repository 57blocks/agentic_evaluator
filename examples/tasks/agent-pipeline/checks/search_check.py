"""Required check for the search step: did the agent find the pages that answer the question?

Runs in the trial's work dir. Passes when findings.json
  - cites every source the answer key lists for this question (recall), and
  - quotes only sentences that are really on the page it cites.
Extra sources are allowed: finding more than needed is not wrong.

Exit 0 passes, 1 fails the candidate; anything else is an evaluator error.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

TASK = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True  # leave no __pycache__ beside the task's sources
sys.path.insert(0, str(TASK))
from app.search import CORPUS, load_page  # noqa: E402


def verdict(passed: bool, evidence: str, reason: str = "") -> None:
    print(json.dumps({"evidence": evidence, **({"reason": reason} if reason else {})}))
    sys.exit(0 if passed else 1)


def main() -> None:
    key = json.loads((TASK / "checks" / "answer_key.json").read_text())
    case = json.loads(Path("meta.json").read_text())["input"]
    wanted = key[case]["sources"]

    if not Path("findings.json").exists():
        verdict(False, "no findings.json", "the agent left no findings")
    try:
        sources = json.loads(Path("findings.json").read_text())["sources"]
    except (ValueError, KeyError) as e:
        verdict(False, "findings.json is not {sources: [...]}", f"unreadable findings: {e}")

    pages = {p.stem: load_page(p) for p in CORPUS.glob("*.md")}
    invented = [
        f"{s.get('id')}: {quote!r}"
        for s in sources
        for quote in s.get("excerpts", [])
        if s.get("id") not in pages or quote not in pages[s["id"]]["text"]
    ]
    found = [s.get("id") for s in sources]
    missed = [w for w in wanted if w not in found]

    evidence = f"found {', '.join(found) or 'nothing'}; needed {', '.join(wanted)} (recall {len(wanted) - len(missed)}/{len(wanted)})"
    if invented:
        verdict(False, evidence, f"quotes not on the page they cite: {'; '.join(invented)}")
    if missed:
        verdict(False, evidence, f"missed {', '.join(missed)}: part of the question went unsearched")
    verdict(True, evidence)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # a broken check or task: an evaluator error, never the candidate's failure
        print(f"check crashed: {e!r}", file=sys.stderr)
        sys.exit(2)
