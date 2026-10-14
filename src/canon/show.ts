/**
 * `show` globs: which of a trial's files a reader is given. The human review
 * (`evaluators.human.show`) and the judge (`evaluators.judge.show`) both pick
 * files this way, relative to the trial's work dir.
 */

/** One glob segment as a regex fragment: `*` and `?` stay within the segment. */
function segmentRegex(seg: string): string {
  const escaped = seg.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
}

function globRegex(pattern: string): RegExp {
  const parts = pattern.split("/");
  let re = "";
  parts.forEach((seg, i) => {
    const last = i === parts.length - 1;
    if (seg === "**") re += last ? ".*" : "(?:.*/)?"; // any depth, including none
    else re += segmentRegex(seg) + (last ? "" : "/");
  });
  return new RegExp(`^${re}$`);
}

/** `show` globs, relative to a trial's work dir: `*` and `?` within a segment, `**` across. */
export function matchesShow(relPath: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => globRegex(p).test(relPath));
}
