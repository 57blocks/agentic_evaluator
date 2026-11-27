/**
 * What `kind: findings-match` leads its report with when the spec declares
 * no `report`: the PRD's separate measures (catch rate, false alarms,
 * precision), by where the item came from. It leads with the defects a
 * reviewer could have known, when the answer key says which those are.
 *
 * Category, severity and knowability belong to a defect, and an item's tags
 * would count an item's every defect under each of them. So they are not
 * slices here: the matcher reports each defect as a part (canon/parts.ts),
 * and the catch rate per category, severity and knowability is read from
 * the parts. One number per question: the item-level `knowable` tags stay
 * on the items, folded under "Other slices".
 */

import type { CheckReport } from "../canon/headline.js";
import { CATEGORIES, SEVERITIES } from "./types.js";

const MATCHED = ["matched_deterministic", "matched_llm"];

export const FINDINGS_MATCH_REPORT: CheckReport = {
  headline: [
    { label: "Knowable defects caught", measure: "knowable_caught", of: "knowable_defects" },
    { label: "Defects caught", measure: "caught", of: "defects", by_slice: true },
    { label: "Defect claims per clean item", measure: "defect_claims", by_slice: true },
    { label: "Precision on defect items", measure: MATCHED, of: [...MATCHED, "unmatched_findings"] },
    { label: "Findings per review", measure: "findings" },
  ],
  slice_groups: [{ title: "Source", tags: ["escaped", "seeded", "clean"] }],
  input_groups: [
    { tag: "escaped", title: "Escaped-defect items", pass: "every known defect caught" },
    { tag: "seeded", title: "Seeded-defect items", pass: "every known defect caught" },
    { tag: "clean", title: "Clean items", pass: "no finding claims a defect" },
  ],
  parts: {
    title: "Every known defect",
    tag_groups: [
      { title: "Could a reviewer have known", tags: ["knowable", "not-knowable"] },
      { title: "Category", tags: [...CATEGORIES] },
      { title: "Severity", tags: [...SEVERITIES] },
    ],
  },
};
