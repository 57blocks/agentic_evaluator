/** Building blocks every report section is made of. */

import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SECTION_CARD, SECTION_TITLE } from "@/components/section-style";

interface SectionProps {
  title: string;
  /** One line under the title: what the section answers. */
  hint?: string;
  children: ReactNode;
}

export function Section({ title, hint, children }: SectionProps) {
  return (
    <Card className={SECTION_CARD}>
      <CardHeader>
        <CardTitle className={SECTION_TITLE}>{title}</CardTitle>
        {hint && <CardDescription>{hint}</CardDescription>}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

/**
 * A collapsed block of detail. Native `<details>` so it still opens and
 * closes in an exported file, which carries no JavaScript.
 */
interface FoldProps {
  title: string;
  count?: string;
  /** Open on arrival — for the evidence a reader should not have to go looking for. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Fold({ title, count, defaultOpen = false, children }: FoldProps) {
  return (
    <details className="group border border-border bg-card" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium select-none">
        <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
        {title}
        {count && <span className="font-normal text-muted-foreground">{count}</span>}
      </summary>
      <div className="flex min-w-0 flex-col gap-3 border-t border-border px-4 py-4">{children}</div>
    </details>
  );
}

/** A note under a table: how the numbers above were counted. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

/** Inline code in running text. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="bg-muted px-1 py-0.5 font-mono text-[12px]">{children}</code>;
}

/** GAPS.md wraps identifiers in backticks; render them as code, everything else as text. */
export function WithCode({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  return <>{parts.map((part, i) => (i % 2 === 1 ? <Code key={i}>{part}</Code> : part))}</>;
}

/** A labelled number, the way a reader scans a summary. */
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-muted/60 px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-lg font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}


export { Tag, type TagTone } from "@/components/tag";
