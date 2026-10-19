/**
 * Three synthetic coverage policies in the shape public medical policies
 * take: scope, criteria, definitions, limits, exceptions, exclusions and a
 * revision history. Invented plan, invented numbers; any resemblance to a
 * real payer's criteria is the genre, not a copy.
 */

export const POLICIES = {
  "MP-214": {
    title: "Continuous Glucose Monitors",
    effective: "2026-01-01",
    sections: [
      ["§1", "Scope. This policy applies to commercial and individual plans. It does not apply to Medicare Advantage plans, which follow MP-214-MA."],
      ["§2.1", "A continuous glucose monitor (CGM) is covered for members with diabetes who use insulin, or who have documented problematic hypoglycemia."],
      ["§2.2", "Problematic hypoglycemia means two or more level 2 events (glucose below 54 mg/dL), or one level 3 event (an event that needed another person's help)."],
      ["§2.3", "Members under 18 with any type of diabetes are covered without meeting §2.1."],
      ["§3.1", "Prior authorization is required for the initial CGM device. Replacement sensors do not require prior authorization."],
      ["§3.2", "Replacement sensors are limited to a 90-day supply per dispensing."],
      ["§3.3", "A replacement receiver is covered once every 36 months. A receiver lost or stolen within that period is not replaced."],
      ["§4.1", "A CGM used only for fitness, sports or weight-loss monitoring, without a diagnosis of diabetes, is not covered."],
      ["§4.2", "Smartphones and smartwatches are not covered, even when used as the CGM display."],
      ["§5", "Revision history. 2026-01-01: §2.2 changed from three or more level 2 events to two or more."],
    ],
  },
  "MP-307": {
    title: "Positive Airway Pressure for Obstructive Sleep Apnea",
    effective: "2026-07-01",
    sections: [
      ["§1", "Scope. This policy applies to adults on all commercial plans."],
      ["§2.1", "A positive airway pressure (PAP) device is covered for an initial 90 days for adults with obstructive sleep apnea (OSA) diagnosed by a sleep test showing an apnea-hypopnea index (AHI) of 15 or more, or an AHI of 5 to 14 with documented excessive daytime sleepiness, hypertension, or a history of stroke."],
      ["§2.2", "A home sleep apnea test and an in-lab polysomnography are both acceptable for §2.1."],
      ["§3.1", "Coverage continues after the initial 90 days only if the member used the device 4 or more hours a night on at least 70% of nights in a 30-day period within the first 90 days, and had a face-to-face visit with the treating clinician between day 31 and day 91."],
      ["§3.2", "A member who did not meet §3.1 may requalify after a new face-to-face evaluation and a repeat sleep test performed in a lab. A home test is not accepted for requalification."],
      ["§4.1", "Replacement supplies: one full face mask every 3 months; two nasal cushions per month."],
      ["§4.2", "A heated humidifier is covered with any covered PAP device."],
      ["§5", "PAP therapy for snoring without a diagnosis of OSA is not covered."],
      ["§6", "Revision history. 2026-07-01: the adherence threshold in §3.1 changed from 60% of nights to 70%."],
    ],
  },
  "MP-118": {
    title: "Outpatient Physical Therapy",
    effective: "2026-04-01",
    sections: [
      ["§1", "Scope. This policy applies to members of all ages on commercial plans."],
      ["§2.1", "Outpatient physical therapy (PT) is covered for up to 30 visits per calendar year, combined with occupational therapy (OT) visits."],
      ["§2.2", "Visits beyond the limit in §2.1 are covered with prior authorization when the member is recovering from surgery performed in the last 6 months."],
      ["§2.3", "A PT evaluation visit counts toward the limit in §2.1. A re-evaluation visit does not."],
      ["§3.1", "Telehealth PT visits are covered on the same terms as in-person visits, except that the initial evaluation must be in person."],
      ["§3.2", "Visits must be with a licensed physical therapist, or a PT assistant supervised by one."],
      ["§4", "Maintenance therapy (to keep current function, with no improvement expected) is not covered, except for members with a progressive neurological condition as defined in §4.1."],
      ["§4.1", "Progressive neurological condition means multiple sclerosis, Parkinson's disease, or amyotrophic lateral sclerosis (ALS)."],
      ["§5", "Aquatic therapy is covered as PT when a licensed physical therapist performs it."],
      ["§6", "Revision history. 2026-04-01: the visit limit in §2.1 rose from 20 to 30; re-evaluations no longer count toward it."],
    ],
  },
};

export function renderPolicy(id) {
  const p = POLICIES[id];
  return [`Sample Health Plan · Medical Policy ${id} · ${p.title}`, `Effective ${p.effective}`, "", ...p.sections.map(([no, text]) => `${no} ${text}`)].join("\n");
}

export const sectionsOf = (id) => POLICIES[id].sections.map(([no]) => no);
