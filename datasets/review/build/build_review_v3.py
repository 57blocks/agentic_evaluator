"""Builds the reviewer workbook for the v3 sets: a stratified, readable sample of
the dev split, with the answer key beside each input and the cells a domain
reviewer fills.

    python3 datasets/review/build/build_review_v3.py [PER_ARCHETYPE] [YYYY-MM-DD]

PER_ARCHETYPE items (default 10) of every archetype in each set: 70 Medicare
claims (7 archetypes) and 80 KYC extracts (8). Sampling is seeded and spread
across clean and noisy items, so the same command builds the same workbook.
Only dev items are sampled: the holdout never leaves the machine that holds it.
"""

import datetime, json, os, random, sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
TASKS = os.path.normpath(os.path.join(HERE, "../../tasks"))
# "all": every item of every split (dev, calibration and, where this machine
# has it, holdout), for the internal review; a number: that many per archetype from dev.
ALL = len(sys.argv) > 1 and sys.argv[1] == "all"
PER_ARCHETYPE = None if ALL else int(sys.argv[1]) if len(sys.argv) > 1 else 10
DATE = sys.argv[2] if len(sys.argv) > 2 else datetime.date.today().isoformat()
OUT = os.path.normpath(os.path.join(HERE, f"../review-v3-{'all-' if ALL else ''}{DATE}.xlsx"))
SPLITS = ["dev", "calibration", "holdout"]
SAMPLE_SEED = 20261119

FONT = "Arial"
HEAD = PatternFill("solid", fgColor="1F3864")
KEY_FILL = PatternFill("solid", fgColor="E2EFDA")
INPUT_FILL = PatternFill("solid", fgColor="FFFF00")
thin = Side(style="thin", color="BFBFBF")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
ROW_LINE_PX = 12
MAX_ROW_HEIGHT = 409

VERDICTS = ["Key is right", "Key is wrong", "Key is incomplete", "Input lacks information", "Input is ambiguous", "Unsure"]
FIELD_MARKS = ["Right", "Wrong"]

CLAIM_RULES = {
    "R1": "R1 Timely filing: one calendar year after the Through date (42 CFR 424.44); a wrongful timely-filing denial is reopened, not appealed (405.926(n), 405.980(c)(1))",
    "R3": "R3 Unprocessable (MA130): no appeal rights; submit a new claim within the filing limit",
    "R4": "R4 Qualifying stay: three inpatient days counted from the admission order; observation does not count",
    "R5": "R5 Benefit periods: a new period after 60 days out of hospital and SNF; 100 SNF days per period",
    "R6": "R6 Duplicate of a paid claim: write off",
}
CLAIM_FIELDS = [("root_cause", "Root cause"), ("correctable", "Correctable"), ("next_action", "Next action"), ("deadline", "Deadline")]
KYC_FIELDS = [("beneficial_owners", "Beneficial owners"), ("fictitious_beneficial_owners", "Fictitious beneficial owners")]


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def stratified(items, archetype_of, n, rng):
    """n items per archetype, half clean-or-light noise and half heavier noise where the archetype has both."""
    by_kind = {}
    for item in items:
        by_kind.setdefault(archetype_of(item), []).append(item)
    chosen = []
    for kind in sorted(by_kind):
        pool = sorted(by_kind[kind], key=lambda i: (len(i["metadata"]["noise"]), i["id"]))
        light, heavy = pool[: len(pool) // 2], pool[len(pool) // 2 :]
        take_light = min(len(light), n // 2)
        picked = rng.sample(light, take_light) + rng.sample(heavy, min(len(heavy), n - take_light))
        chosen.extend(sorted(picked, key=lambda i: i["id"]))
    return chosen


def plus_days(iso, days):
    return (datetime.date.fromisoformat(iso) + datetime.timedelta(days=days)).isoformat()


def anniversary(iso):
    return f"{int(iso[:4]) + 1}{iso[4:]}"


def deadline_why(item):
    """Which rule set the deadline, and the date before R7 moved it off a weekend or holiday."""
    e, parse = item["expected"], item["expected"]["steps"]["parse"]
    if e["deadline"] is None:
        return ""
    if e["next_action"] == "appeal":
        base, rule = plus_days(parse["remittance_date"], 125), "R2 redetermination: 120 days from receipt, presumed 5 days after the remittance"
    elif e["next_action"] == "corrected_claim":
        base, rule = anniversary(parse["statement_through"]), "R1/R3 new claim within one year of the Through date"
    else:
        base, rule = anniversary(parse["remittance_date"]), "R1 reopening within one year of the remittance (405.980(c)(1))"
    rolled = base != e["deadline"] or bool(e.get("deadline_also_accepted"))
    return f"\nDeadline: {rule} = {base}" + ("; R7: that day is a weekend or federal holiday, so the next workday" if rolled else "")


def claim_why(item):
    return CLAIM_RULES[item["metadata"]["rule_family"]] + deadline_why(item)


def show_claim_field(e, field):
    value = e.get(field)
    if field == "deadline" and e.get("deadline_also_accepted"):
        return f"{value} (also accepted: {', '.join(e['deadline_also_accepted'])})"
    return "null (no deadline)" if value is None else str(value)


def show_kyc_field(e, field):
    value = e[field]
    if not value:
        return "none"
    if field == "beneficial_owners":
        return "\n".join(f"{o['name']}: {o['basis']}" for o in value)
    return "\n".join(value)


def header(ws, col, text, width):
    c = ws.cell(row=1, column=col, value=text)
    c.font = Font(name=FONT, bold=True, color="FFFFFF")
    c.fill = HEAD
    c.alignment = Alignment(wrap_text=True, vertical="center")
    c.border = BOX
    ws.column_dimensions[get_column_letter(col)].width = width


def put(ws, row, col, value, fill=None, mono=False):
    c = ws.cell(row=row, column=col, value=value)
    c.font = Font(name="Courier New" if mono else FONT, size=9 if mono else 10)
    c.alignment = Alignment(wrap_text=True, vertical="top")
    c.border = BOX
    if fill:
        c.fill = fill
    return c


def item_sheet(wb, title, items, fields, show_field, context_of):
    ws = wb.create_sheet(title)
    columns = [("ID", 16), ("Split", 12), ("Case type", 18), ("Rule / why", 40), ("Noise in this input", 22), ("Input (what the model sees)", 90)]
    INPUT_COL = len(columns)
    columns += [(f"Key: {label}", 22) for _, label in fields]
    columns += [("Your verdict on the key", 20)] + [(f"{label} right?", 12) for _, label in fields] + [("Comment (what is wrong, and the right answer)", 40)]
    for col, (text, width) in enumerate(columns, 1):
        header(ws, col, text, width)
    ws.freeze_panes = "B2"
    verdict = DataValidation(type="list", formula1=f'"{",".join(VERDICTS)}"', allow_blank=True)
    mark = DataValidation(type="list", formula1=f'"{",".join(FIELD_MARKS)}"', allow_blank=True)
    ws.add_data_validation(verdict)
    ws.add_data_validation(mark)
    first_input = INPUT_COL + 1 + len(fields)
    for r, item in enumerate(items, 2):
        kind, why = context_of(item)
        noise = ", ".join(item["metadata"]["noise"]) or "none (clean)"
        cells = [item["id"], item["split"], kind, why, noise]
        for col, value in enumerate(cells, 1):
            put(ws, r, col, value)
        put(ws, r, INPUT_COL, item["input"], mono=True)
        for k, (field, _) in enumerate(fields):
            put(ws, r, INPUT_COL + 1 + k, show_field(item["expected"], field), fill=KEY_FILL)
        put(ws, r, first_input, None, fill=INPUT_FILL)
        verdict.add(ws.cell(row=r, column=first_input))
        for k in range(len(fields)):
            put(ws, r, first_input + 1 + k, None, fill=INPUT_FILL)
            mark.add(ws.cell(row=r, column=first_input + 1 + k))
        put(ws, r, first_input + 1 + len(fields), None, fill=INPUT_FILL)
        ws.row_dimensions[r].height = min(MAX_ROW_HEIGHT, ROW_LINE_PX * (item["input"].count("\n") + 2))
    return ws


def intro(wb, counts):
    ws = wb.active
    ws.title = "Read me"
    ws.column_dimensions["A"].width = 120
    lines = [
        (f"Answer-key review: claim-denials-snf-v3 and kyc-ubo-v3 ({'every item' if ALL else 'dev sample'})", True),
        (f"Built {DATE}. {counts['claims']} Medicare SNF claims and {counts['kyc']} German KYC register extracts, "
         + ("every item of every split, dev first, then calibration, then holdout. INTERNAL ONLY: the holdout rows must not leave the team or be used to tune prompts."
            if ALL else f"{PER_ARCHETYPE} of every case type, spread across clean and noisy inputs."), False),
        ("", False),
        ("What we ask", True),
        ("Read each input as the model does, then judge the answer key in green: is it what the rules require? Fill the yellow cells.", False),
        ("Verdict: 'Key is right' when every field is right. Otherwise mark the wrong field(s) and say in the comment what the right answer is and why (cite the rule if you can).", False),
        ("Noise is deliberate: mixed date and amount formats, one-line 835s, irrelevant records, a missing non-essential field, scanned-looking labels. "
         "If noise makes an item impossible to answer with confidence, choose 'Input is ambiguous' and say which part.", False),
        ("", False),
        ("Medicare SNF claims", True),
        ("Traditional Medicare Part A; the model is not given the payer manual. The key follows claim-denials-snf-v2/RULES.md (42 CFR, CMS manuals, X12 codes). "
         "Deadlines are the last day the rules allow; one that falls on a weekend or federal holiday runs to the next workday (R7).", False),
        ("German KYC extracts", True),
        ("Beneficial owners under § 3 GwG as the BVA Transparenzregister applies it. The key follows kyc-ubo-v2/RULES.md. "
         "The basis text is shown for context; the names are what is graded.", False),
        ("", False),
        ("Everything here is synthetic: no real people, claims or companies.", False),
    ]
    for r, (text, bold) in enumerate(lines, 1):
        c = ws.cell(row=r, column=1, value=text)
        c.font = Font(name=FONT, bold=bold, size=12 if bold else 10)
        c.alignment = Alignment(wrap_text=True, vertical="top")


def every_item(task):
    """Every split this machine has, in order; the holdout file exists only where its seed does."""
    items = []
    for split in SPLITS:
        path = os.path.join(TASKS, task, *(["holdout"] if split == "holdout" else []), f"{task}.{split}.jsonl")
        if os.path.exists(path):
            items += read_jsonl(path)
        else:
            print(f"{task}: no {split} file on this machine, left out")
    return items


def main():
    if ALL:
        claims, kyc = every_item("claim-denials-snf-v3"), every_item("kyc-ubo-v3")
    else:
        rng = random.Random(SAMPLE_SEED)
        claims = stratified(read_jsonl(os.path.join(TASKS, "claim-denials-snf-v3", "claim-denials-snf-v3.dev.jsonl")), lambda i: i["id"].split("-")[2], PER_ARCHETYPE, rng)
        kyc = stratified(read_jsonl(os.path.join(TASKS, "kyc-ubo-v3", "kyc-ubo-v3.dev.jsonl")), lambda i: i["metadata"]["rule_family"], PER_ARCHETYPE, rng)
    wb = Workbook()
    intro(wb, {"claims": len(claims), "kyc": len(kyc)})
    item_sheet(wb, "Medicare claims", claims, CLAIM_FIELDS, show_claim_field,
               lambda i: (i["tags"][1], claim_why(i)))
    item_sheet(wb, "KYC extracts", kyc, KYC_FIELDS, show_kyc_field,
               lambda i: (i["metadata"]["rule_family"], ", ".join(t for t in i["tags"] if not t.startswith("noise:") and t not in ("hard", "normal", "clean"))))
    wb.save(OUT)
    print(f"{OUT}: {len(claims)} claims, {len(kyc)} KYC extracts")


if __name__ == "__main__":
    main()
