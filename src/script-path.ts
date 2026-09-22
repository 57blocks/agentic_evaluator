/**
 * Is this argv entry a declared script path, or just an argument?
 *
 * Two places spawn a command a spec declared — a `kind: command` required
 * check and an `agent-cli` candidate — and both must tell a path apart from
 * an argument before resolving it. They used to disagree: the check resolved
 * against the task dir and reported a missing file, the adapter resolved
 * against the harness root and silently passed the unresolved string through
 * to the shell. One of those is a diagnosis; the other is how a broken path
 * turns into a stack trace recorded as a candidate's deliverable.
 */

/**
 * Deliberately narrow: an inline program (`node -e "a/b"`) is an argument,
 * not a path, and must not be mistaken for a missing file.
 */
const SCRIPT_PATH = /^(?:\.{1,2}\/)?[\w.@-]+(?:\/[\w.@-]+)*\.(?:mjs|cjs|js|ts|py|sh)$/;

export function looksLikePath(arg: string): boolean {
  return SCRIPT_PATH.test(arg);
}
