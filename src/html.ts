/**
 * HTML primitives shared by BOTH report layers.
 *
 * Neutral on purpose: the canonical pages (`report-v2.ts`, `report-charts.ts`,
 * `report-evidence.ts`) must not import from the legacy renderer, or retiring
 * `render.ts` would take them down with it. Nothing here knows about Report,
 * Scorecard, or any layer's shapes — add only dependency-free string helpers.
 */

/**
 * Escape a dynamic value for inclusion in HTML text or an attribute value.
 * Quotes are escaped too: a system prompt goes into a `title="…"` attribute,
 * and a `"` inside it would otherwise end the attribute.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
