/**
 * Boilerplate sections: the bulk of every agreement, and where the distractors
 * live. `{{P}}` / `{{C}}` are the parties' defined names; `{{x}}` placeholders
 * are filled per item (see render.mjs DISTRACTORS). None of these sections
 * states a term the check grades: they hold numbers of the same kind (other
 * day counts, dollar amounts, durations, places) in the wrong place.
 */

export const SECTIONS = [
  ["Definitions — General", [
    "\"Affiliate\" means any entity that directly or indirectly controls, is controlled by, or is under common control with a party, where \"control\" means ownership of more than fifty percent (50%) of the voting interests of the entity.",
    "\"Business Day\" means any day other than a Saturday, Sunday or a day on which national banks in {{bank_city}} are authorized to close.",
    "\"Documentation\" means the user guides, specifications and operating manuals that {{P}} makes generally available for the Services, as updated from time to time.",
    "\"Personnel\" means the employees, agents and permitted subcontractors of a party who perform obligations under this Agreement.",
  ]],
  ["Statements of Work", [
    "The specific services, deliverables, milestones and fees for each engagement will be set out in a statement of work signed by authorized representatives of both parties (each, an \"SOW\"). Each SOW incorporates the terms of this Agreement.",
    "{{P}} shall not begin work under an SOW until it has been signed by both parties. Work performed before signature is at {{P}}'s own risk and expense.",
    "Each SOW will identify a project manager for each party. The project managers will meet at least every {{pm_days}} days to review progress, risks and open decisions.",
  ]],
  ["Change Control", [
    "Either party may request a change to the scope, schedule or fees of an SOW by written change request. {{P}} shall respond within {{change_days}} Business Days with an estimate of the impact on schedule and fees.",
    "No change is binding until a change order describing it is signed by both parties. {{P}} is not obliged to perform any change until that change order is signed.",
  ]],
  ["Fees and Invoicing", [
    "{{C}} shall pay all undisputed amounts within {{pay_days}} days after the date of {{P}}'s invoice. Invoices shall be issued monthly in arrears unless an SOW states otherwise.",
    "Amounts not paid when due bear interest at the lesser of one and one-half percent (1.5%) per month and the highest rate permitted by law, from the due date until paid.",
    "{{C}} may withhold any amount it disputes in good faith by notifying {{P}} of the dispute within {{dispute_days}} days of the invoice date, with reasonable detail of the reasons. The parties shall work together to resolve any dispute promptly.",
  ]],
  ["Expenses", [
    "{{C}} shall reimburse {{P}} for reasonable travel and out-of-pocket expenses that {{C}} has approved in writing in advance, at cost and without mark-up, provided they comply with {{C}}'s travel policy as provided to {{P}}.",
    "Expense claims must be submitted within {{expense_days}} days after the expense is incurred, with receipts for any single item above two hundred fifty dollars ($250).",
  ]],
  ["Taxes", [
    "Fees exclude sales, use, value added and similar taxes. {{C}} shall pay any such taxes that {{P}} is required to collect, other than taxes on {{P}}'s net income, property or employees.",
    "If {{C}} is required by law to withhold tax from a payment, it shall pay the amount withheld to the relevant authority and provide {{P}} with evidence of payment within {{tax_days}} days.",
  ]],
  ["Personnel and Subcontracting", [
    "{{P}} shall assign Personnel with the skills and experience reasonably required to perform the Services. {{P}} may replace key Personnel named in an SOW only with {{C}}'s prior written consent, which shall not be unreasonably withheld.",
    "{{P}} may use subcontractors only with {{C}}'s prior written consent. {{P}} remains responsible for the acts and omissions of its subcontractors as if they were its own.",
    "{{P}} shall ensure that its Personnel comply with {{C}}'s reasonable site, security and safety rules when on {{C}}'s premises.",
  ]],
  ["Acceptance", [
    "{{C}} shall test each deliverable against the acceptance criteria in the applicable SOW within {{accept_days}} Business Days of delivery and notify {{P}} in writing of acceptance or of any non-conformity.",
    "If {{C}} reports a non-conformity, {{P}} shall correct it and redeliver within {{redeliver_days}} days, and the acceptance procedure shall be repeated. If a deliverable fails acceptance three (3) times, {{C}} may terminate the applicable SOW and recover the fees paid for that deliverable.",
  ]],
  ["Confidentiality", [
    "Each party (the \"Recipient\") shall keep confidential all non-public information disclosed by the other party (the \"Discloser\") that is marked confidential or would reasonably be understood to be confidential (\"Confidential Information\"), and shall use it only to perform or receive the benefit of this Agreement.",
    "The Recipient may disclose Confidential Information to its Personnel and professional advisers who need to know it and are bound by obligations of confidentiality no less protective than this Section.",
    "These obligations continue for {{conf_years_word}} ({{conf_years}}) years after the expiration or termination of this Agreement, and for trade secrets for as long as they remain trade secrets under applicable law.",
    "Within {{return_days}} days after a written request, the Recipient shall return or destroy the Discloser's Confidential Information, except for copies retained in routine backups or as required by law.",
  ]],
  ["Data Protection", [
    "To the extent {{P}} processes personal data on behalf of {{C}}, it shall do so only on {{C}}'s documented instructions and in accordance with the data processing terms in Schedule D.",
    "{{P}} shall notify {{C}} without undue delay, and in any event within {{breach_hours}} hours, after becoming aware of a security incident affecting {{C}}'s personal data.",
    "{{P}} shall retain {{C}}'s data for no longer than {{retention_days}} days after the end of the applicable SOW, after which it shall securely delete that data unless retention is required by law.",
  ]],
  ["Information Security", [
    "{{P}} shall maintain administrative, physical and technical safeguards designed to protect {{C}}'s data, consistent with a recognized industry framework such as ISO/IEC 27001 or the NIST Cybersecurity Framework.",
    "{{P}} shall perform vulnerability scans of systems that process {{C}}'s data at least every {{scan_days}} days and remediate critical findings within {{remediate_days}} days.",
  ]],
  ["Intellectual Property", [
    "Upon payment in full of the applicable fees, {{C}} shall own all deliverables created specifically for {{C}} under an SOW, and {{P}} hereby assigns to {{C}} all rights in them.",
    "{{P}} retains all rights in its pre-existing materials, tools and know-how, and in any general improvements to them. To the extent any of them is incorporated in a deliverable, {{P}} grants {{C}} a perpetual, non-exclusive, royalty-free license to use it as part of that deliverable.",
  ]],
  ["Warranties", [
    "{{P}} warrants that the Services will be performed in a professional and workmanlike manner consistent with generally accepted industry standards, and that each deliverable will conform in all material respects to its specifications for {{warranty_days}} days after acceptance.",
    "{{C}}'s exclusive remedy for breach of the warranty in this Section is for {{P}} to re-perform the non-conforming Services or, if {{P}} cannot do so within a reasonable time, a refund of the fees paid for them.",
    "EXCEPT AS EXPRESSLY STATED IN THIS AGREEMENT, NEITHER PARTY MAKES ANY OTHER WARRANTY, EXPRESS OR IMPLIED, INCLUDING ANY IMPLIED WARRANTY OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.",
  ]],
  ["Indemnification", [
    "{{P}} shall defend {{C}} against any third-party claim alleging that a deliverable infringes a patent, copyright or trademark, and pay any damages finally awarded or agreed in settlement.",
    "The indemnified party shall give prompt notice of the claim, allow the indemnifying party to control its defense, and provide reasonable cooperation at the indemnifying party's expense.",
  ]],
  ["Insurance", [
    "{{P}} shall maintain, with insurers rated A- or better, commercial general liability insurance of at least {{ins_gl_words}} dollars ({{ins_gl}}) per occurrence, professional liability insurance of at least {{ins_pl_words}} dollars ({{ins_pl}}) per claim, and workers' compensation insurance as required by law.",
    "{{P}} shall provide certificates of insurance on request and give {{C}} at least {{ins_notice_days}} days' notice before any required policy is cancelled or materially reduced.",
  ]],
  ["Audit", [
    "{{C}} may, on {{audit_notice_days}} days' written notice and no more than once in any twelve (12) month period, audit {{P}}'s records relating to fees charged under this Agreement.",
    "{{P}} shall keep those records for at least {{records_years_word}} ({{records_years}}) years after the fees are invoiced. If an audit shows an overcharge of more than five percent (5%), {{P}} shall bear the reasonable cost of the audit.",
  ]],
  ["Non-Solicitation", [
    "During the term of this Agreement and for {{nonsolicit_months_word}} ({{nonsolicit_months}}) months after it ends, neither party shall solicit for employment any employee of the other party who was directly involved in performing this Agreement, except through general advertisements not targeted at such employees.",
  ]],
  ["Force Majeure", [
    "Neither party is liable for any delay or failure to perform caused by events beyond its reasonable control, including fire, flood, war, epidemic, governmental action or failure of public utilities, provided it gives prompt notice and uses reasonable efforts to resume performance.",
    "If a force majeure event prevents performance for more than {{fm_days}} consecutive days, either party may terminate the affected SOW on written notice.",
  ]],
  ["Termination", [
    "Either party may terminate this Agreement or any SOW on written notice if the other party materially breaches it and fails to cure the breach within {{cure_days}} days after receiving written notice describing it.",
    "Either party may terminate this Agreement immediately on written notice if the other party becomes insolvent, makes a general assignment for the benefit of creditors, or has a receiver appointed for its business.",
    "{{C}} may terminate any SOW for convenience on {{convenience_days}} days' written notice, paying for Services performed up to the effective date of termination.",
  ]],
  ["Effect of Termination", [
    "On termination, {{C}} shall pay all fees for Services performed through the effective date of termination, and each party shall return the other's Confidential Information as provided in this Agreement.",
    "At {{C}}'s request, {{P}} shall provide reasonable transition assistance for up to {{transition_days}} days after termination, at the rates then in effect.",
  ]],
  ["Compliance with Laws", [
    "Each party shall comply with all laws applicable to its performance of this Agreement, including anti-bribery laws and the export control and economic sanctions laws of the United States.",
    "Neither party shall export, re-export or transfer any deliverable in violation of the export control laws of the United States or of any other applicable jurisdiction.",
  ]],
  ["Dispute Escalation", [
    "The parties shall first attempt to resolve any dispute through their project managers. If unresolved within {{escalate_days}} days, either party may escalate it to an executive of each party, who shall meet within a further {{exec_days}} days.",
    "Nothing in this Section prevents a party from seeking urgent injunctive relief.",
  ]],
  ["Venue", [
    "Each party irrevocably submits to the exclusive jurisdiction of the state and federal courts located in {{venue_county}}, {{venue_state}}, for any action arising out of or relating to this Agreement, and waives any objection to venue in those courts.",
  ]],
  ["Notices", [
    "Notices under this Agreement must be in writing and delivered by hand, by nationally recognized overnight courier, or by email with confirmation of receipt, to the addresses set out on the signature page or as later updated by notice.",
    "A notice is effective on receipt, or if delivered by courier, {{courier_days}} Business Day(s) after dispatch.",
  ]],
  ["Assignment", [
    "Neither party may assign this Agreement without the other party's prior written consent, except to an Affiliate or to a successor to all or substantially all of its business to which this Agreement relates, on written notice to the other party.",
  ]],
  ["Publicity", [
    "Neither party shall use the other's name or logo in any publicity, customer list or marketing material without the other's prior written consent.",
  ]],
  ["Independent Contractors", [
    "The parties are independent contractors. Nothing in this Agreement creates a partnership, joint venture, agency or employment relationship between them.",
  ]],
  ["Entire Agreement and Amendment", [
    "This Agreement, including its Schedules and each SOW, is the entire agreement of the parties on its subject and supersedes all prior proposals and understandings.",
    "This Agreement may be amended only by a written instrument signed by authorized representatives of both parties.",
  ]],
  ["Severability and Waiver", [
    "If any provision of this Agreement is held invalid, the remaining provisions remain in effect. A failure to enforce a provision is not a waiver of it.",
  ]],
  ["Counterparts", [
    "This Agreement may be signed in counterparts, including by electronic signature, each of which is an original and all of which together are one instrument.",
  ]],
];
