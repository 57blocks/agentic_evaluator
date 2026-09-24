/**
 * The masthead, and the trail back to the list.
 *
 * With no sidebar there is one way back, so it has to be visible on every
 * detail page: the crumbs are links, not decoration.
 */

import { Moon, Sun } from "lucide-react";
import { navigate, type Route } from "./routes";
import { useTheme } from "./theme";

export interface Crumb {
  label: string;
  route?: Route;
}

/** The protocol site's mark: two bars and a tick. */
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
      <rect x="2" y="2" width="4" height="18" rx="1" className="fill-brand-2" />
      <rect x="9" y="2" width="4" height="18" rx="1" className="fill-brand-2" />
      <path
        d="M15 12.5l2.4 2.4L21 9.5"
        fill="none"
        className="stroke-foreground"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Switches between light and dark; the icon shows what a click switches to. */
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

/** The bar across the top, as on the protocol site: mark, name, protocol version. */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-card shadow-(--shadow-bar)">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <button
          type="button"
          onClick={() => navigate({ view: "home" })}
          className="flex items-center gap-2.5 text-base font-bold tracking-tight focus-visible:underline focus-visible:outline-none"
        >
          <Mark />
          Agentic Evaluator
          <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">Protocol v0.3</span>
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}

/** The trail back to the list, above each detail page. */
export function Crumbs({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs">
      <button
        type="button"
        onClick={() => navigate({ view: "home" })}
        className="text-muted-foreground underline-offset-2 hover:underline"
      >
        Overview
      </button>
      {crumbs.map((crumb, i) => (
        <span key={`${crumb.label}-${i}`} className="flex items-center gap-1.5">
          <span className="text-muted-foreground">/</span>
          {crumb.route && i < crumbs.length - 1 ? (
            <button
              type="button"
              onClick={() => crumb.route && navigate(crumb.route)}
              className="font-mono text-muted-foreground underline-offset-2 hover:underline"
            >
              {crumb.label}
            </button>
          ) : (
            <span className="font-mono">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
