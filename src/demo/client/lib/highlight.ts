/**
 * Syntax colouring for the task page's file viewer.
 *
 * highlight.js core with only the languages a task is made of — spec YAML,
 * Markdown rubrics and prompts, TypeScript and JavaScript checks and agents,
 * JSON config, shell scripts — rather than the full bundle. Its output
 * escapes the source, which is what makes rendering it as HTML safe.
 */

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("yaml", yaml);

/** Past this, colouring costs more than it helps; the file is shown plain. */
const MAX_HIGHLIGHT_CHARS = 200_000;

const BY_EXTENSION: Record<string, string> = {
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  sh: "bash",
};

export function languageFor(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? null;
}

/** Highlighted, escaped HTML for a file's text; null when it should be shown as plain text. */
export function highlightFile(path: string, text: string): string | null {
  const language = languageFor(path);
  if (!language || text.length > MAX_HIGHLIGHT_CHARS) return null;
  return hljs.highlight(text, { language, ignoreIllegals: true }).value;
}
