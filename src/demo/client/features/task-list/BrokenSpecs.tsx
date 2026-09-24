/**
 * Tasks whose spec does not load, each with the loader's reason.
 *
 * Shown above the task list rather than folded away: a task missing from the
 * list with no word said is exactly the silent absence this tool refuses.
 */

import type { BrokenSpec } from "../../../catalog.js";
import { SECTION_CARD } from "@/components/section-style";
import { Tag } from "@/components/tag";
import { cn } from "@/lib/utils";

export function BrokenSpecs({ broken }: { broken: readonly BrokenSpec[] }) {
  if (broken.length === 0) return null;
  return (
    <section
      aria-label="Tasks that could not be read"
      className={cn(SECTION_CARD, "flex flex-col gap-3 border border-l-4 border-border border-l-bad bg-card p-4")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="bad">{broken.length} could not be read</Tag>
        <p className="text-xs text-muted-foreground">
          These tasks are left out of the list until their spec loads. Their runs, if any, are kept under unfiled runs.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {broken.map((b) => (
          <li key={b.path} className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-xs font-semibold">{b.path}</span>
            <span className="font-mono text-[11px] break-words text-bad">{b.error}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
