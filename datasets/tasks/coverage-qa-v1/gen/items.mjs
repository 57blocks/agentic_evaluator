/**
 * The questions and their answer keys. `cite` is the list of citations the
 * answer must carry: each entry is one section, or a list of sections any of
 * which will do (when two clauses each decide the question on their own).
 * Tags say what makes an item hard:
 *
 *   two-clause     the answer needs two sections read together
 *   exception      a later clause overrides a general one
 *   revision       the revision history changed the rule; the old one gives the wrong answer
 *   scope          the policy does not apply, or applies only in part
 *   limit          a count, a period or a quantity decides it
 *   not-addressed  the policy is silent; inventing coverage either way is the failure
 *   normal         a direct read of one clause
 */

export const ITEMS = [
  // MP-214 Continuous glucose monitors
  { policy: "MP-214", q: "Is a CGM covered for a member with type 2 diabetes who takes metformin only and has had two documented level 2 hypoglycemic events?", answer: "yes", cite: ["§2.1", "§2.2"], tags: ["two-clause", "revision"] },
  { policy: "MP-214", q: "A member with diet-controlled type 2 diabetes (no insulin) has had one level 2 hypoglycemic event. Is a CGM covered?", answer: "no", cite: ["§2.1", "§2.2"], tags: ["two-clause"] },
  { policy: "MP-214", q: "Is a CGM covered for a 15-year-old with type 2 diabetes who does not use insulin and has had no hypoglycemic events?", answer: "yes", cite: ["§2.3"], tags: ["exception"] },
  { policy: "MP-214", q: "Do replacement CGM sensors need prior authorization?", answer: "no", cite: ["§3.1"], tags: ["normal"] },
  { policy: "MP-214", q: "Can a member get a six-month supply of replacement sensors in one dispensing?", answer: "no", cite: ["§3.2"], tags: ["limit"] },
  { policy: "MP-214", q: "A member lost their CGM receiver 20 months after receiving it. Is a replacement receiver covered now?", answer: "no", cite: ["§3.3"], tags: ["limit"] },
  { policy: "MP-214", q: "Under this policy, is a CGM covered for a Medicare Advantage member who uses insulin?", answer: "not_addressed", cite: ["§1"], tags: ["scope"] },
  { policy: "MP-214", q: "Will the plan pay for a smartwatch that a covered member uses to display their CGM readings?", answer: "no", cite: ["§4.2"], tags: ["normal"] },
  { policy: "MP-214", q: "A marathon runner without diabetes wants a CGM to tune their training. Is it covered?", answer: "no", cite: [["§4.1", "§2.1"]], tags: ["normal"] },
  { policy: "MP-214", q: "Does this policy cover insulin pumps?", answer: "not_addressed", cite: [], tags: ["not-addressed"] },

  // MP-307 Positive airway pressure
  { policy: "MP-307", q: "An adult's sleep test shows an AHI of 10. No daytime sleepiness, hypertension or stroke is documented. Is a PAP device covered?", answer: "no", cite: ["§2.1"], tags: ["normal"] },
  { policy: "MP-307", q: "An adult with hypertension has an AHI of 9 on a home sleep apnea test. Is a PAP device covered for the initial period?", answer: "yes", cite: ["§2.1", "§2.2"], tags: ["two-clause"] },
  { policy: "MP-307", q: "In the first 90 days, a member used PAP 5 hours a night on 65% of nights in a 30-day period and saw their clinician on day 45. Does coverage continue after day 90?", answer: "no", cite: ["§3.1"], tags: ["revision", "limit"] },
  { policy: "MP-307", q: "A member who did not meet the adherence requirement wants to requalify using a new home sleep apnea test and a new face-to-face evaluation. Is that enough?", answer: "no", cite: ["§3.2"], tags: ["exception"] },
  { policy: "MP-307", q: "Is a heated humidifier covered for a member whose CPAP is covered?", answer: "yes", cite: ["§4.2"], tags: ["normal"] },
  { policy: "MP-307", q: "Can a member get two full face masks within the same three months?", answer: "no", cite: ["§4.1"], tags: ["limit"] },
  { policy: "MP-307", q: "A member snores loudly; their sleep test shows an AHI of 2 and no OSA diagnosis. Is PAP covered?", answer: "no", cite: [["§5", "§2.1"]], tags: ["normal"] },
  { policy: "MP-307", q: "Does this policy cover an oral appliance (mandibular advancement device) for OSA?", answer: "not_addressed", cite: [], tags: ["not-addressed"] },
  { policy: "MP-307", q: "An adult's in-lab polysomnography shows an AHI of 22. Is a PAP device covered for the initial period?", answer: "yes", cite: ["§2.1"], tags: ["normal"] },
  { policy: "MP-307", q: "A member used PAP 4.5 hours a night on 80% of nights in their first month, but their face-to-face visit was on day 100. Does coverage continue after day 90?", answer: "no", cite: ["§3.1"], tags: ["limit"] },

  // MP-118 Outpatient physical therapy
  { policy: "MP-118", q: "A member has had 24 PT visits and 6 OT visits this calendar year and no recent surgery. Is another PT visit covered?", answer: "no", cite: ["§2.1"], tags: ["limit"] },
  { policy: "MP-118", q: "A member has used all 30 visits this year. They had a knee replacement 3 months ago and have prior authorization. Are more PT visits covered?", answer: "yes", cite: ["§2.2"], tags: ["exception"] },
  { policy: "MP-118", q: "A member has used all 30 visits this year. Their shoulder surgery was 9 months ago. Are more PT visits covered?", answer: "no", cite: ["§2.2"], tags: ["limit"] },
  { policy: "MP-118", q: "Does a PT re-evaluation visit count toward the annual visit limit?", answer: "no", cite: ["§2.3"], tags: ["revision"] },
  { policy: "MP-118", q: "Is an initial PT evaluation done by telehealth covered?", answer: "no", cite: ["§3.1"], tags: ["exception"] },
  { policy: "MP-118", q: "After an in-person evaluation, are follow-up PT visits by telehealth covered?", answer: "yes", cite: ["§3.1"], tags: ["normal"] },
  { policy: "MP-118", q: "Is maintenance PT covered for a member with Parkinson's disease?", answer: "yes", cite: ["§4", "§4.1"], tags: ["two-clause", "exception"] },
  { policy: "MP-118", q: "A member had a stroke two years ago and is stable. Is maintenance PT to keep their current function covered?", answer: "no", cite: ["§4"], tags: ["two-clause"] },
  { policy: "MP-118", q: "Is aquatic therapy covered when a licensed physical therapist performs it?", answer: "yes", cite: ["§5"], tags: ["normal"] },
  { policy: "MP-118", q: "Does this policy cover chiropractic spinal manipulation?", answer: "not_addressed", cite: [], tags: ["not-addressed"] },
];
