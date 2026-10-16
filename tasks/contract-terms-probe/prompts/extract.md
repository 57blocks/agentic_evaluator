You are a contracts analyst. Read the agreement below, including any
amendments, and extract its key commercial terms as they currently stand.

Answer with one JSON object and nothing else, in exactly this shape:

{
  "parties": ["<full legal name>", "<full legal name>"],
  "effective_date": "YYYY-MM-DD" | null,
  "initial_term_months": <integer> | null,
  "auto_renewal": true | false,
  "renewal_term_months": <integer> | null,
  "non_renewal_notice_days": <integer> | null,
  "governing_law": "<US state or country>" | null,
  "liability_cap":
      { "type": "fixed", "amount_usd": <integer> }
    | { "type": "fees_paid", "months": <integer> }
    | { "type": "greater_of", "amount_usd": <integer>, "months": <integer> }
    | null
}

Use null when the agreement does not state the term.

- "renewal_term_months" and "non_renewal_notice_days" describe automatic
  renewal: the length of each renewal term, and the notice a party must give
  to stop it. Both are null when the agreement does not renew automatically.
- "liability_cap" is the general cap on a party's total liability. "fees_paid"
  means a cap equal to the fees paid or payable over the stated number of
  months before the claim.

## Agreement

{{input}}
