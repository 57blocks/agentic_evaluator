/** Which run this is, in one line a reader can place. */

import type { ReactNode } from "react";

interface Props {
  eyebrow: string;
  title: ReactNode;
  subtitle: string;
}

export function ReportHeader({ eyebrow, title, subtitle }: Props) {
  return (
    <header className="flex flex-col gap-1">
      <p className="text-[13px] font-semibold text-brand">{eyebrow}</p>
      <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </header>
  );
}

/** Reproduction facts — spec hash, judge, harness — for whoever needs to rerun it. */
export function RunFacts({ facts }: { facts: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-6 gap-y-3">
      {facts.map((f) => (
        <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{f.label}</dt>
          <dd className="font-mono text-xs break-words">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
