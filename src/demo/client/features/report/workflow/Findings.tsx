/** What only the cross-step view shows, each with the numbers that made it fire. */

import type { Finding } from "../../../../../workflow-report-model.js";
import { Badge } from "@/components/ui/badge";

export function Findings({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  return (
    <section aria-label="发现" className="flex flex-col gap-2">
      {findings.map((f, i) => (
        <article key={i} className="flex flex-col gap-1 rounded-lg border border-l-4 border-border border-l-foreground/40 bg-card px-4 py-3">
          <header className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">{f.tag}</Badge>
            <h3 className="text-sm font-medium">{f.title}</h3>
          </header>
          <p className="text-xs leading-relaxed text-muted-foreground">{f.body}</p>
        </article>
      ))}
    </section>
  );
}
