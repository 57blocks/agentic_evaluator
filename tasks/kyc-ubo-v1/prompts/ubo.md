You are a KYC analyst. Identify the beneficial owners of the company under
review from the ownership structure below.

Apply exactly these rules:

1. A natural person who holds more than 25% of the company under review
   directly is a beneficial owner, on the basis "direct". Exactly 25% is not
   more than 25%.
2. A natural person who controls a company that holds more than 25% of the
   company under review is a beneficial owner, on the basis "control".
   Control means holding more than 50% of a company; exactly 50% is not
   control. Control passes down a chain: whoever controls a company also
   controls every company it controls.
3. Multiplying percentages through a chain does not make anyone a beneficial
   owner. Only rule 1 or rule 2 does.
4. If nobody qualifies under rules 1 and 2, set "fallback" to true and record
   every managing director of the company under review in
   "recorded_under_fallback". Otherwise "fallback" is false and that list is
   empty.

Answer with one JSON object and nothing else:

{
  "beneficial_owners": [{ "name": "<full name>", "basis": "direct" | "control" }],
  "fallback": true | false,
  "recorded_under_fallback": ["<full name>"],
  "reasoning": "<one short paragraph: who qualifies, who does not, and why>"
}

Write names exactly as they appear in the structure.

## Ownership structure

{{input}}
