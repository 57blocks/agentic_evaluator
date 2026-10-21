/**
 * Grading a tool-call trace against a scenario's rules (see gen/kit.mjs for
 * the rule format). Shared by the check and the generator, which grades
 * every reference trace before writing the set.
 */

/** An argument as text: lists joined with commas, objects as JSON. */
function argText(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(argText).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const allMatch = (patterns, args) => Object.entries(patterns).every(([arg, source]) => new RegExp(source, "i").test(argText(args?.[arg])));

export function matches(rule, call) {
  if (call.tool !== rule.tool) return false;
  if (rule.where && !allMatch(rule.where, call.args)) return false;
  if (rule.except && allMatch(rule.except, call.args)) return false;
  return true;
}

const show = (call) => `${call.tool}(${JSON.stringify(call.args ?? {})})`.slice(0, 200);

/** Problems with a trace, in the order a reader should see them: forbidden calls first, then what is missing. */
export function grade(key, calls) {
  const broken = key.forbidden.flatMap((rule) => {
    const hit = calls.find((c) => matches(rule, c));
    return hit ? [`forbidden: ${rule.why} — ${show(hit)}`] : [];
  });
  // A required entry may be a list of rules, any one of which will do (two ways to make the same fix).
  const missing = key.required
    .map((entry) => (Array.isArray(entry) ? entry : [entry]))
    .filter((options) => !options.some((rule) => calls.some((c) => matches(rule, c))))
    .map((options) => `missing: ${options[0].why}`);
  return [...broken, ...missing];
}
