You are a KYC analyst at a German bank. From the register extracts below,
determine the beneficial owners (wirtschaftlich Berechtigte) of the company
named first, under § 3 GwG as applied in the German Transparenzregister
(BVA practice). If no natural person qualifies, give the persons who count
as fictitious beneficial owners (fiktive wirtschaftlich Berechtigte) instead.

Answer with one JSON object and nothing else:

{
  "beneficial_owners": [{ "name": "<full name>", "basis": "<why, briefly>" }],
  "fictitious_beneficial_owners": ["<full name>"],
  "reasoning": "<one short paragraph: who qualifies, who does not, and why>"
}

Leave "fictitious_beneficial_owners" empty when anyone qualifies. Write names
exactly as they appear in the extracts.

## Register extracts

{{input}}
