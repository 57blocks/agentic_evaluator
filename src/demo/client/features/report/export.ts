/**
 * Export the report exactly as it renders: the page's own markup and its own
 * stylesheet, written into one HTML file that opens with no server, no
 * network and no React.
 *
 * What is exported is what the reader was looking at — the DOM, not a second
 * render — so the file can never say something the page did not. Controls
 * that only work inside the dashboard carry `data-export-omit` and are
 * dropped. Font files are dropped too: they are served by the dashboard and
 * would be dead links in a file on disk, so the export falls back to the
 * system font rather than fetching.
 */

/** Follow the OS theme, as the dashboard does, since the stock theme keys dark mode on a class. */
const THEME_SCRIPT =
  'document.documentElement.classList.toggle("dark",matchMedia("(prefers-color-scheme: dark)").matches)';

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Every rule the page is styled with, minus the font files it cannot carry. */
function pageCss(): string {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      // A cross-origin sheet cannot be read; the dashboard serves none.
      continue;
    }
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSFontFaceRule) continue;
      rules.push(rule.cssText);
    }
  }
  return rules.join("\n");
}

export function standaloneHtml(root: HTMLElement, title: string): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-export-omit]").forEach((node) => node.remove());
  // Collapsed sections stay collapsed; the reader opens what they need.
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}</title>
<script>${THEME_SCRIPT}</script>
<style>${pageCss()}</style>
</head>
<body>
<div class="mx-auto w-full max-w-6xl px-6 py-6">${clone.outerHTML}</div>
</body>
</html>
`;
}

export function downloadHtml(html: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Give the browser a tick to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A filename that is safe on every OS and still says what it is. */
export function exportName(parts: readonly string[]): string {
  return `${parts.join("-").replace(/[^\w.-]+/g, "_")}-report.html`;
}
