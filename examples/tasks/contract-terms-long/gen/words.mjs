/** Numbers as contracts write them: "thirty-six (36)", "$2,500,000", "March 3, 2024". */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function under1000(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (h > 0) parts.push(`${ONES[h]} hundred`);
  if (rest > 0 && rest < 20) parts.push(ONES[rest]);
  else if (rest >= 20) parts.push(TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : ""));
  return parts.join(" ");
}

/** Whole numbers below a billion, in words. */
export function words(n) {
  if (n === 0) return "zero";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  return [millions && `${under1000(millions)} million`, thousands && `${under1000(thousands)} thousand`, rest && under1000(rest)].filter(Boolean).join(" ");
}

/** "thirty-six (36)" */
export const both = (n) => `${words(n)} (${n})`;
/** "$2,500,000" */
export const usd = (n) => `$${n.toLocaleString("en-US")}`;
/** "two million five hundred thousand dollars ($2,500,000)" */
export const usdBoth = (n) => `${words(n)} dollars (${usd(n)})`;

/** ISO date ("2024-03-03") to "March 3, 2024". */
export function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Add whole months to an ISO date and step back one day: the last day of a term that starts on `iso`. */
export function termEnd(iso, months) {
  const [y, m, d] = iso.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1 + months, d) - 86_400_000);
  return end.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}
