/**
 * Building blocks for scenarios: tool declarations the agent sees, and the
 * rules the check applies to the agent's trace.
 *
 * A rule names a tool and, optionally, `where` (every listed argument must
 * match its pattern) and `except` (the call is exempt when every listed
 * argument matches). Patterns are case-insensitive regex sources tested
 * against the argument as text. `required` rules must each match at least
 * one call (an entry that is a list of rules is met by any one of them);
 * `forbidden` rules must match none.
 */

const str = (description) => ({ type: "string", description });

/** A tool as the agent sees it, plus the canned result the simulator returns. */
export function tool(name, description, args, result = "ok") {
  return {
    name,
    description,
    parameters: {
      type: "object",
      properties: Object.fromEntries(Object.entries(args).map(([k, d]) => [k, str(d)])),
      required: Object.keys(args),
    },
    result,
  };
}

export const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An IBAN pattern that tolerates any spacing. */
export const ibanPattern = (iban) => `^\\s*${iban.replace(/\s+/g, "").split("").map(esc).join("\\s*")}\\s*$`;

/** An order number with or without a "PO" prefix. */
export const poPattern = (po) => `^\\s*(PO[-\\s#:]*)?${esc(po)}\\s*$`;

/** A list of addresses, every one of them at this domain. */
export const onlyAt = (domain) => `^\\s*([^\\s,;@]+@${esc(domain)}\\s*[,;]?\\s*)+$`;

export const rule = (tool, why, { where, except } = {}) => ({ tool, why, ...(where ? { where } : {}), ...(except ? { except } : {}) });

export const call = (tool, args) => ({ tool, args });

/**
 * The simulated shell: scripted output for the commands a scenario is about
 * (tests, installs, scripts), and for everything else the scenario's files
 * through agents/workspace.mjs, so cat, ls, test and rm agree with
 * read_file and with each other.
 */
export const SHELL_DESCRIPTION = "Run a shell command in the repository checkout and return its output and exit status.";

/** What the toolchain says about itself, so `which npm` or `node --version` is not a mystery. */
const TOOLCHAIN = [
  { match: "^\\s*(which|type|command\\s+-v)\\s+(npm|node|npx|vault|keytool)\\b", output: "/usr/local/bin/$2" },
  { match: "^\\s*npm\\s+(--version|-v)\\b", output: "10.8.2" },
  { match: "^\\s*node\\s+(--version|-v)\\b", output: "v22.11.0" },
  { match: "^\\s*npm\\s+config\\s+get\\s+registry", output: "https://registry.npmjs.org/" },
  { match: "^\\s*npm\\s+(view|info|show)\\s+(\\S+)", output: "$2@3.0.0 | MIT | deps: none | published 2 months ago" },
  { match: "^\\s*(env|printenv)\\b|\\$PATH", output: "PATH=/usr/local/bin:/usr/bin:/bin" },
];

/**
 * Scripted commands are {match, output, code?, writes?, after?}: `code` is the
 * exit status (0 when absent) and `writes` the files the command leaves.
 */
export const shellResult = (scripted) => ({ by: "command", patterns: [...scripted, ...TOOLCHAIN], shell: true, default: "(exit 0)" });

/** package.json with these dependencies. */
export const packageJson = (deps = {}) => `${JSON.stringify({ name: "app", type: "module", scripts: { test: "vitest run" }, dependencies: deps }, null, 2)}\n`;

/** The file tools, backed by the scenario's `files`. */
export const fileTools = () => [
  tool("list_files", "List files in a directory.", { dir: "Directory" }, "fs:list"),
  tool("read_file", "Read a file.", { path: "File path" }, "fs:read"),
  tool("write_file", "Write a file.", { path: "File path", content: "Full file content" }, "fs:write"),
];

/** Tests fail until the module is rewritten, by write_file or by the shell. */
export const testsPassAfterFix = (src, failingText, passingText = "PASS all tests") => {
  const test = "\\b(npm\\s+(run\\s+)?test|vitest|jest)\\b";
  return [
    { match: test, after: { tool: "write_file", match: esc(src) }, output: passingText },
    { match: test, after: { tool: "run_shell", match: `(>|tee|sed\\s+-i)[^&;|]*${esc(src)}` }, output: passingText },
    { match: test, output: failingText, code: 1 },
  ];
};

/** Either way of writing the fix. */
export const wroteFix = (src) => [
  rule("write_file", `fixed ${src}`, { where: { path: `(^|/)${esc(src)}$` } }),
  rule("run_shell", `fixed ${src}`, { where: { command: `(>|>>|\\btee\\b|\\bsed\\s+-i)[^&;|]*${esc(src)}` } }),
];
