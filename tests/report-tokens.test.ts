/**
 * The dashboard's report page and report.html are one design in two
 * renderers. They cannot share a stylesheet — report.html is a string of
 * inline CSS that must open with no build, the dashboard is Tailwind — so the
 * colours that carry meaning (brand, success, failure, warning, the chosen
 * row) are declared twice and held equal here, in light and in dark.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { INSTALL_ROOT } from "../src/paths.js";
import { PAGE_STYLE } from "../src/report-style.js";

/** report.html's name for a colour → the dashboard's. */
const SAME_COLOUR: Record<string, string> = {
  "--accent": "--brand",
  "--accent-2": "--brand-2",
  "--accent-soft": "--brand-soft",
  "--champ": "--champ",
  "--ok-fg": "--ok",
  "--ok-bg": "--ok-soft",
  "--bad-fg": "--bad",
  "--bad-bg": "--bad-soft",
  "--warn-fg": "--warn",
  "--warn-bg": "--warn-soft",
};

function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) out.set(m[1], m[2].trim().toLowerCase());
  return out;
}

/** Every `selector { … }` block's declarations, merged in source order. */
function blocksFor(css: string, selector: RegExp): Map<string, string> {
  const merged = new Map<string, string>();
  for (const m of css.matchAll(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, "g"))) {
    for (const [k, v] of declarations(m[1])) merged.set(k, v);
  }
  return merged;
}

async function dashboardCss(): Promise<string> {
  return fs.readFile(path.join(INSTALL_ROOT, "src", "demo", "client", "styles.css"), "utf-8");
}

test("the dashboard report uses report.html's meaning colours, in light mode", async () => {
  // Arrange
  const reportLight = declarations(PAGE_STYLE.slice(PAGE_STYLE.indexOf(":root{"), PAGE_STYLE.indexOf("}")));
  const dashLight = blocksFor(await dashboardCss(), /:root/);

  // Assert
  for (const [ours, theirs] of Object.entries(SAME_COLOUR)) {
    assert.equal(dashLight.get(theirs), reportLight.get(ours), `${theirs} should equal report.html ${ours}`);
  }
});

test("the dashboard report uses report.html's meaning colours, in dark mode", async () => {
  // Arrange
  const darkStart = PAGE_STYLE.indexOf("prefers-color-scheme:dark");
  const darkBlock = PAGE_STYLE.slice(PAGE_STYLE.indexOf(":root{", darkStart), PAGE_STYLE.indexOf("}", darkStart));
  const reportDark = declarations(darkBlock);
  const dashDark = blocksFor(await dashboardCss(), /\.dark/);

  // Assert
  for (const [ours, theirs] of Object.entries(SAME_COLOUR)) {
    assert.equal(dashDark.get(theirs), reportDark.get(ours), `dark ${theirs} should equal report.html ${ours}`);
  }
});
