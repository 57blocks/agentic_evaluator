/**
 * The masthead, and the trail back to the list.
 *
 * With no sidebar there is one way back, so it has to be visible on every
 * detail page: the crumbs are links, not decoration.
 */

import { navigate, type Route } from "./routes";

export interface Crumb {
  label: string;
  route?: Route;
}

export function AppHeader({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => navigate({ view: "home" })}
          className="flex items-center gap-2 text-lg font-bold tracking-tight focus-visible:underline focus-visible:outline-none"
        >
          <span aria-hidden className="inline-block size-3 bg-linear-to-br from-brand to-brand-2" />
          Agentic Evaluator
        </button>
      </div>

      {crumbs.length > 0 && (
        <nav aria-label="面包屑" className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => navigate({ view: "home" })}
            className="text-muted-foreground underline-offset-2 hover:underline"
          >
            总览
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
      )}
    </header>
  );
}
