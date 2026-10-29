/**
 * A prompt comparison leads with the prompts. Every candidate is one model,
 * called one way; the reader needs to see what each one was told, and how a
 * variant departs from the step's template, before any number.
 */

import type { PromptComparison as Model, PromptVariant } from "../../../../../report-model.js";
import { diffCounts } from "../../../../../report-diff.js";
import { cn } from "@/lib/utils";
import { Section, Tag } from "../Section";

const PRE = "max-h-[420px] overflow-auto bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-words";

const DIFF_TONE: Record<string, string> = {
  add: "bg-ok-soft text-ok",
  del: "bg-bad-soft text-bad line-through decoration-bad/40",
  same: "text-muted-foreground",
};

const DIFF_MARK: Record<string, string> = { add: "+ ", del: "− ", same: "  " };

function Diff({ variant: v }: { variant: PromptVariant }) {
  if (!v.diff) return null;
  return (
    <pre className={PRE}>
      {v.diff.map((line, i) => (
        <span key={i} className={cn("block", DIFF_TONE[line.kind])}>{DIFF_MARK[line.kind]}{line.text}</span>
      ))}
    </pre>
  );
}

function Variant({ variant: v, stepFile }: { variant: PromptVariant; stepFile: string | null }) {
  const counts = v.diff ? diffCounts(v.diff) : null;
  return (
    <article className="flex flex-col gap-2 border border-border p-3">
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono font-semibold">{v.id}</span>
        {v.own ? (
          <Tag tone="brand" className="font-mono">own template {v.file}</Tag>
        ) : (
          <Tag tone="neutral" className="font-mono">step template{stepFile ? ` ${stepFile}` : ""}</Tag>
        )}
        {counts && <Tag tone="neutral">+{counts.added} / −{counts.removed} lines against the step's</Tag>}
        {v.system !== null && <Tag tone="ok">system prompt</Tag>}
        {v.own && v.text === null && <Tag tone="warn">text not on file</Tag>}
      </header>
      {v.diff ? <Diff variant={v} /> : v.own && v.text !== null ? <pre className={PRE}>{v.text}</pre> : null}
      {v.system !== null && (
        <blockquote className="border-l-2 border-ok pl-3 text-sm">
          <span className="text-xs text-muted-foreground">system prompt, sent with every call</span>
          <p className="whitespace-pre-wrap">{v.system}</p>
        </blockquote>
      )}
    </article>
  );
}

export function PromptComparison({ comparison: c }: { comparison: Model }) {
  const provenance =
    c.source === "current-spec"
      ? " The texts are read from the task's files as they are now: this run predates the manifest freezing them."
      : c.source === "none"
        ? " This run did not record the texts, and the task's files could not be read."
        : "";
  return (
    <Section
      title="Prompts compared"
      hint={`${c.variants.length} candidates, one model (${c.model}, ${c.via}); what differs is the prompt each one was sent.${provenance}`}
    >
      {c.step.file && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm">
            <span className="font-medium">Step template</span> <span className="font-mono text-xs">{c.step.file}</span>
            <span className="text-muted-foreground"> — what a candidate without its own template is sent; a variant below shows its changes against this.</span>
          </p>
          {c.step.text !== null ? <pre className={PRE}>{c.step.text}</pre> : <p className="text-xs text-muted-foreground">Text not on file.</p>}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {c.variants.map((v) => <Variant key={v.id} variant={v} stepFile={c.step.file} />)}
      </div>
    </Section>
  );
}
