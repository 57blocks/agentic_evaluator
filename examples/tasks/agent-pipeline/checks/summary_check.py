"""Required check for the summarize step: is every claim backed by the findings it was given?

Runs in the trial's work dir, which holds the findings the summarizer started
from (findings.json) and its answer (summary.md). Passes when
  - every bullet under "## Answer" cites a source in findings.json, like [s01],
  - most of each bullet's words appear in what that source says (a
    deterministic stand-in for "supported"; a judge can grade paraphrase), and
  - the answer states each fact the answer key requires for this question.

Exit 0 passes, 1 fails the candidate; anything else is an evaluator error.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

TASK = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True  # leave no __pycache__ beside the task's sources
sys.path.insert(0, str(TASK))
from app.search import terms  # noqa: E402

SUPPORTED = 0.6  # share of a claim's words that must appear in its cited source


def verdict(passed: bool, evidence: str, reason: str = "") -> None:
    print(json.dumps({"evidence": evidence, **({"reason": reason} if reason else {})}))
    sys.exit(0 if passed else 1)


def main() -> None:
    key = json.loads((TASK / "checks" / "answer_key.json").read_text())
    case = json.loads(Path("meta.json").read_text())["input"]

    if not Path("summary.md").exists():
        verdict(False, "no summary.md", "the agent left no answer")
    summary = Path("summary.md").read_text()
    findings = json.loads(Path("findings.json").read_text())
    said = {s["id"]: " ".join(s["excerpts"]) for s in findings["sources"]}

    answer = summary.split("## Answer", 1)[-1].split("## Sources", 1)[0]
    claims = [line[2:].strip() for line in answer.splitlines() if line.startswith("- ")]
    problems = []
    for claim in claims:
        cited = re.search(r"\[(s\d+)\]\s*$", claim)
        if not cited:
            problems.append(f"no citation: {claim!r}")
            continue
        source = cited.group(1)
        if source not in said:
            problems.append(f"cites {source}, which is not in the findings: {claim!r}")
            continue
        words = set(terms(claim[: cited.start()]))
        backed = len(words & set(terms(said[source]))) / max(len(words), 1)
        if backed < SUPPORTED:
            problems.append(f"{source} does not support {claim!r} ({backed:.0%} of its words)")

    missing = [fact for fact in key[case]["must_mention"] if fact not in summary]
    evidence = f"{len(claims)} claim(s), {len(claims) - len(problems)} supported; {len(key[case]['must_mention']) - len(missing)}/{len(key[case]['must_mention'])} required facts stated"
    if not claims:
        verdict(False, evidence, "no claims under '## Answer'")
    if problems:
        verdict(False, evidence, "; ".join(problems))
    if missing:
        verdict(False, evidence, f"does not state: {', '.join(missing)}")
    verdict(True, evidence)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # a broken check or task: an evaluator error, never the candidate's failure
        print(f"check crashed: {e!r}", file=sys.stderr)
        sys.exit(2)
