/**
 * One longer policy with a group rider and a definitions section, and eight
 * questions whose answers are computed: a count of visits left, a last
 * covered date, or yes / no / not_addressed where a clause far from the
 * obvious one decides it. v1 put the deciding clause next to the question
 * and every model got it; here the answer needs the definitions, the rider,
 * the revision's date of service, or an exception to an exception.
 *
 * `answer` is "yes", "no", "not_addressed", a whole number, or a date
 * (YYYY-MM-DD); a list when more than one reading is right. `cite` lists the sections the answer must cite; an entry
 * that is a list is met by any one of them.
 */

export const POLICY_ID = "MP-118";

export const SECTIONS = [
  ["§1", "Scope. This policy applies to members of all ages on commercial plans. A group rider in Appendix R replaces the clauses it names, for that group's members only."],
  ["§2.1", "Outpatient therapy is covered for up to 30 visits per calendar year, with physical therapy (PT), occupational therapy (OT) and speech therapy (ST) visits counted together."],
  ["§2.2", "Visits beyond the limit in §2.1 are covered with prior authorization while the member is within 6 months after a surgery: a surgery on the 15th of a month covers visits through the 15th of the sixth month after it (for example, March 15 through September 15)."],
  ["§2.3", "A therapy evaluation counts toward the limit in §2.1. A re-evaluation does not count toward it and is covered."],
  ["§3.1", "Telehealth visits are covered on the same terms as in-person visits, except that the initial evaluation must be in person."],
  ["§4", "Maintenance therapy (to keep current function, with no improvement expected) is not covered, except for members with a progressive neurological condition (§7.3), subject to §5."],
  ["§5", "For a member who resides in a skilled nursing facility, therapy is covered under the facility benefit, not under this policy."],
  ["§6", "Revision history. 2026-04-01: the limit in §2.1 rose from 20 to 30 visits, and re-evaluations stopped counting toward it. A visit with a date of service before 2026-04-01 is governed by the prior version (a limit of 20 visits; re-evaluations count)."],
  ["§7.1", "Definition: visit. All sessions in one discipline on one date of service are one visit."],
  ["§7.2", "Definition: surgery. A procedure performed in an operating room. Injections and diagnostic arthroscopy are not surgery."],
  ["§7.3", "Definition: progressive neurological condition. Multiple sclerosis, Parkinson's disease, or amyotrophic lateral sclerosis (ALS)."],
  ["§R1", "Appendix R, Larkspur Foods group rider. For this group, the limit in §2.1 is 40 visits per calendar year, and speech therapy visits do not count toward it."],
  ["§R2", "Appendix R, Larkspur Foods group rider. For this group, the initial evaluation may be done by telehealth, replacing the exception in §3.1."],
];

const CLAIMS = "Their 2026 therapy claims, all with dates of service after April 1: 18 PT sessions on 16 dates (one of those dates was a re-evaluation), OT on 9 dates, and speech therapy on 4 dates.";

export const ITEMS = [
  { q: `A member on a standard plan. ${CLAIMS} How many more covered therapy visits does the member have in 2026, without prior authorization?`, answer: 2, cite: ["§2.1"], tags: ["computed", "definition", "two-clause"] },
  { q: `A member of the Larkspur Foods group. ${CLAIMS} How many more covered therapy visits does the member have in 2026, without prior authorization?`, answer: 16, cite: ["§R1"], tags: ["computed", "rider", "definition"] },
  { q: "A standard-plan member used all 30 visits by June 2026. They had a knee replacement in an operating room on 2026-03-15, and prior authorization is on file. What is the last date of service on which additional visits are covered?", answer: "2026-09-15", cite: ["§2.2"], tags: ["computed", "boundary"] },
  { q: "A standard-plan member has used all 30 visits this year. Two months ago they had a cortisone injection in the knee, and their therapist requested prior authorization. Is another PT visit covered?", answer: "no", cite: ["§2.2", "§7.2"], tags: ["definition", "two-clause"] },
  { q: "A standard-plan member had 20 PT visits between 2026-01-05 and 2026-03-10, none of them re-evaluations. Is a PT visit on 2026-03-20 covered, without prior authorization?", answer: "no", cite: ["§6"], tags: ["revision", "date-of-service"] },
  { q: "A standard-plan member's 30th counted visit of 2026 was on 2026-08-01, and they have no recent surgery. Is a PT re-evaluation on 2026-08-20 covered?", answer: "yes", cite: ["§2.3"], tags: ["exception"] },
  { q: "A member with Parkinson's disease lives in a skilled nursing facility. Is maintenance PT covered under this policy?", answer: ["no", "not_addressed"], cite: ["§5"], tags: ["exception-to-exception", "scope"] },
  { q: "A member of the Larkspur Foods group wants their initial PT evaluation by telehealth. Is it covered?", answer: "yes", cite: ["§R2"], tags: ["rider", "exception"] },
];
