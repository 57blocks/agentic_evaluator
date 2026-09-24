/**
 * Light or dark: the OS decides until the reader picks one with the toggle,
 * and the pick is remembered in this browser.
 *
 * The stylesheet is shadcn's, which swaps its tokens on a `.dark` class
 * rather than a media query, so the resolved theme is applied as that class.
 * Storage is a convenience: when it is unavailable (private window, blocked
 * site data) the toggle still works for the session.
 */

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "agenteval-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** What the page shows: the stored pick if there is one, else the OS's. */
export function resolveTheme(stored: Theme | null, systemDark: boolean): Theme {
  return stored ?? (systemDark ? "dark" : "light");
}

export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

/** Anything but a valid theme name is treated as no pick. */
export function parseStoredTheme(raw: string | null): Theme | null {
  return raw === "light" || raw === "dark" ? raw : null;
}

function readStored(): Theme | null {
  try {
    return parseStoredTheme(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStored(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage blocked: the pick lasts until the page closes.
  }
}

function apply(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** Apply the theme before the first render, so the page does not flash. */
export function initTheme(): void {
  apply(resolveTheme(readStored(), window.matchMedia(DARK_QUERY).matches));
}

/** The current theme and a toggle. Follows OS changes until the reader picks. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [picked, setPicked] = useState<Theme | null>(readStored);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  const theme = resolveTheme(picked, systemDark);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => apply(theme), [theme]);

  const toggle = useCallback(() => {
    const next = nextTheme(theme);
    writeStored(next);
    setPicked(next);
  }, [theme]);

  return { theme, toggle };
}
