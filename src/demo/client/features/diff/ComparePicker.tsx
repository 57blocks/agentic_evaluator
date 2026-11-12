/**
 * Pick any two of a task's runs to compare. Live dashboard only: an export
 * carries just each run against the one before it (its run page links there).
 */

import { useState } from "react";
import type { RunView } from "../../../catalog.js";
import { navigate } from "@/app/routes";
import { runStamp } from "@/lib/format";
import { Button } from "@/components/ui/button";

function RunSelect({ label, runs, value, onChange }: { label: string; runs: readonly RunView[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 border border-border bg-background px-2 font-mono text-[13px] text-foreground">
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            {runStamp(r)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** `runs` newest first, as the task lists them; the default compares the newest with the one before it. */
export function ComparePicker({ runs }: { runs: readonly RunView[] }) {
  const [before, setBefore] = useState(runs[1]?.id ?? "");
  const [after, setAfter] = useState(runs[0]?.id ?? "");
  if (runs.length < 2) return null;
  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
      <RunSelect label="Before" runs={runs} value={before} onChange={setBefore} />
      <span className="pb-1.5 text-muted-foreground">→</span>
      <RunSelect label="After" runs={runs} value={after} onChange={setAfter} />
      <Button size="sm" variant="outline" disabled={before === after} onClick={() => navigate({ view: "diff", before, after })}>
        Compare
      </Button>
    </div>
  );
}
