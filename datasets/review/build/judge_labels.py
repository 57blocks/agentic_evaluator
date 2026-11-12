"""Turns a finished answer-key review into labels for `agenteval calibrate`.

For each reviewed model on each item, one JSONL line saying whether its
answer was right or wrong, joined to the run the review was built from. The
join is checked, not assumed: an answer the review shows as graded wrong must
carry the same check reason in the run's row, and one shown as right must
have passed there. Any mismatch stops the script.

What each label rests on (`basis`):

  key-confirmed   the check passed and the reviewer confirmed the key, so the
                  answer equals a right key; no one read the answer itself
  reviewed        the check failed and the reviewer said whether the grading
                  stands (模型确实错 → wrong; 模型对/模型也对 → right)

Left out of the main file: items the reviewer could not settle (题目信息不足,
题目有歧义, 不确定), and every filing-through-date item. The latter go to a
separate file, because the key change they led to (R1, accepted in #25) makes
their labels a reading, not a review:

  derived-r1             the check passed on a key later superseded → wrong
  reviewed               the check failed on a flagged item; the reviewer's call
  reviewed-old-reading   the check failed on an unflagged item, judged under
                         the reading R1 overturned

    python3 datasets/review/build/judge_labels.py 2026-10-22
"""

import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REVIEW = os.path.normpath(os.path.join(HERE, "..", sys.argv[1] if len(sys.argv) > 1 else "2026-10-22"))
TASKS = os.path.normpath(os.path.join(HERE, "../../tasks"))

# The runs each review's workbook was built from, combined into one run per set.
SETS = {
    "claim-denials": ("claim-denials-snf-v2", "claim-denials-snf-v2-combined-2026-10-21T00-51-44-560Z"),
    "kyc-ubo-v2": ("kyc-ubo-v2", "kyc-ubo-v2-combined-2026-10-21T00-51-45-005Z"),
}
UNSETTLED = {"题目信息不足", "题目有歧义", "不确定"}
KEY_SUPERSEDED = "filing-through-date"  # R1


def rows_of(task, run):
    path = os.path.join(TASKS, task, "runs", run, "scores.jsonl")
    with open(path, encoding="utf-8") as f:
        return {(r["candidate"], r["input"]): r for r in map(json.loads, f)}


def check_join(name, item, model, row):
    """The answer the reviewer saw must be the one in the run."""
    shown = item[f"{model}_grading"]
    if shown.startswith("✔"):
        if row["task_outcome"] != "success":
            sys.exit(f"{name} {item['id']} {model}: the review shows a pass, the run a {row['task_outcome']}")
        return
    reasons = [c.get("reason", "") for c in row["checks"].values()]
    if f"✘ {reasons[0] if reasons else ''}" != shown:
        sys.exit(f"{name} {item['id']} {model}: the review shows {shown!r}, the run's check says {reasons!r}")


def label_of(item, model, passed, stands):
    if item["type"] == KEY_SUPERSEDED:
        if passed:
            return "wrong", "derived-r1"
        right = stands.startswith("模型对") or stands.startswith("模型也对")
        return ("right" if right else "wrong"), ("reviewed" if item["verdict"] == "答案有误" else "reviewed-old-reading")
    if passed:
        return "right", "key-confirmed"
    right = stands.startswith("模型对") or stands.startswith("模型也对")
    return ("right" if right else "wrong"), "reviewed"


def main():
    out_dir = os.path.join(REVIEW, "judge-labels")
    os.makedirs(out_dir, exist_ok=True)
    for name, (task, run) in SETS.items():
        rows = rows_of(task, run)
        with open(os.path.join(REVIEW, f"{name}.csv"), encoding="utf-8") as f:
            review = list(csv.DictReader(f))
        models = [k[: -len("_grading_stands")] for k in review[0] if k.endswith("_grading_stands")]
        files = {"main": [], "r1": []}
        for item in review:
            if item["verdict"] in UNSETTLED:
                continue
            for model in models:
                row = rows.get((model, item["id"]))
                if row is None:
                    sys.exit(f"{name} {item['id']} {model}: no row in {run}")
                check_join(name, item, model, row)
                passed = item[f"{model}_grading"].startswith("✔")
                label, basis = label_of(item, model, passed, item[f"{model}_grading_stands"])
                line = {"candidate": model, "input": item["id"], "trial": row["trial"], "label": label, "group": item["type"], "basis": basis}
                files["r1" if item["type"] == KEY_SUPERSEDED else "main"].append(line)
        for part, lines in files.items():
            if not lines:
                continue
            path = os.path.join(out_dir, f"{name}{'-r1-derived' if part == 'r1' else ''}.jsonl")
            with open(path, "w", encoding="utf-8") as f:
                f.writelines(json.dumps(l, ensure_ascii=False) + "\n" for l in lines)
            print(f"{os.path.relpath(path)}: {len(lines)} labels ({run})")


main()
