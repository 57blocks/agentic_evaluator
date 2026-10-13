/**
 * Blind human review of one run (docs/design/human-review.md).
 *
 * One pair per screen: the input, then two answers as Left and Right. No
 * candidate id, model, cost, time or check result is on the page — the
 * server never sends them until the reviewer reveals. Each verdict is saved
 * as it is given; a reload resumes where the reviewer stopped.
 */

import { useCallback, useEffect, useState } from "react";
import { getJson, postReveal, postVerdict, reviewUrl, type ReviewSession, type ScreenVerdict } from "@/lib/api";
import { navigate } from "@/app/routes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AnswerPane } from "./AnswerPane";

const CHOICES: Array<{ value: ScreenVerdict; label: string; key: string }> = [
  { value: "left", label: "Left better", key: "a" },
  { value: "right", label: "Right better", key: "b" },
  { value: "tie", label: "Tie", key: "t" },
  { value: "both_bad", label: "Both bad", key: "x" },
];

function Choice({ value, onChange, compact }: { value: ScreenVerdict | undefined; onChange: (v: ScreenVerdict) => void; compact?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onChange(c.value)}
          className={cn(
            "rounded-md border px-2.5 text-sm",
            compact ? "py-0.5 text-xs" : "py-1.5",
            value === c.value ? "border-brand bg-brand text-brand-foreground" : "hover:bg-muted",
          )}
        >
          {c.label}
          {!compact && <span className="ml-1.5 text-xs opacity-60">{c.key}</span>}
        </button>
      ))}
    </div>
  );
}

function NamePrompt({ runId }: { runId: string }) {
  const [name, setName] = useState("");
  return (
    <form
      className="mx-auto flex max-w-md flex-col gap-3 py-10"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) navigate({ view: "review", runId, reviewer: name.trim() });
      }}
    >
      <h2 className="text-lg font-semibold">Who is reviewing?</h2>
      <p className="text-sm text-muted-foreground">Your verdicts are saved under this name, and the left/right layout is fixed for it.</p>
      <input className="rounded-md border bg-background px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={64} />
      <Button type="submit" disabled={!name.trim()}>Start reviewing</Button>
    </form>
  );
}

export function ReviewPage({ runId, reviewer }: { runId: string; reviewer: string }) {
  const [includeFailed, setIncludeFailed] = useState(false);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [overall, setOverall] = useState<ScreenVerdict | undefined>();
  const [dims, setDims] = useState<Record<string, ScreenVerdict>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmReveal, setConfirmReveal] = useState(false);

  const load = useCallback(async () => {
    if (!reviewer) return;
    try {
      const s = await getJson<ReviewSession>(reviewUrl(runId, reviewer, includeFailed));
      setSession(s);
      setError(null);
      return s;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId, reviewer, includeFailed]);

  useEffect(() => {
    load().then((s) => {
      if (!s) return;
      const firstOpen = s.pairs.findIndex((p) => p.verdict === null);
      setIndex(firstOpen === -1 ? 0 : firstOpen);
    });
  }, [load]);

  const pair = session?.pairs[index];
  useEffect(() => {
    setOverall(pair?.verdict?.overall);
    setDims(pair?.verdict?.dimensions ?? {});
    setNote(pair?.verdict?.note ?? "");
  }, [pair]);

  const save = useCallback(async () => {
    if (!session || !pair || !overall || session.revealed) return;
    setSaving(true);
    try {
      await postVerdict(runId, { reviewer, pairId: pair.id, overall, dimensions: dims, note });
      await load();
      setIndex((i) => Math.min(i + 1, session.pairs.length - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [session, pair, overall, dims, note, runId, reviewer, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      const choice = CHOICES.find((c) => c.key === e.key);
      if (choice) setOverall(choice.value);
      else if (e.key === "Enter") void save();
      else if (e.key === "j") setIndex((i) => Math.min(i + 1, (session?.pairs.length ?? 1) - 1));
      else if (e.key === "k") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, session]);

  if (!reviewer) return <NamePrompt runId={runId} />;
  if (error && !session) return <p className="py-10 text-center text-bad">{error}</p>;
  if (!session) return <p className="py-10 text-center text-muted-foreground">Loading the review…</p>;

  const total = session.pairs.length;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Blind review · {session.step}</h2>
          <p className="text-sm text-muted-foreground">
            {reviewer} · {session.done} of {total} pairs reviewed{session.revealed ? " · revealed" : ""}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={includeFailed} onChange={(e) => setIncludeFailed(e.target.checked)} />
          include pairs where a side failed its check{session.hiddenFailed > 0 && !includeFailed ? ` (${session.hiddenFailed} hidden)` : ""}
        </label>
      </header>

      <details className="rounded-lg border bg-card px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold">Rubric · {session.rubric.file}</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{session.rubric.text}</pre>
      </details>

      {total === 0 || !pair ? (
        <p className="py-10 text-center text-muted-foreground">
          Nothing to review: no input has two answers that both passed their check.
          {session.hiddenFailed > 0 && " Tick the box above to review pairs where a side failed."}
        </p>
      ) : (
        <>
          <nav className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setIndex((i) => Math.max(i - 1, 0))} disabled={index === 0}>← Previous (k)</Button>
            <span className="text-sm">
              Pair {index + 1} / {total} · input <span className="font-mono">{pair.input.slug}</span>
              {pair.verdict && <span className="ml-2 text-ok">reviewed</span>}
            </span>
            <Button variant="outline" size="sm" onClick={() => setIndex((i) => Math.min(i + 1, total - 1))} disabled={index === total - 1}>Next (j) →</Button>
          </nav>

          <details className="rounded-lg border bg-card px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold">Input</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{pair.input.text}</pre>
          </details>

          <div className="grid gap-3 md:grid-cols-2">
            <AnswerPane label="Left" files={pair.left.files} revealedAs={pair.revealed?.left} />
            <AnswerPane label="Right" files={pair.right.files} revealedAs={pair.revealed?.right} />
          </div>

          <section className="flex flex-col gap-3 rounded-lg border bg-card p-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Overall</span>
              <Choice value={overall} onChange={setOverall} />
            </div>
            {session.dimensions.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {session.dimensions.map((d) => (
                  <div key={d} className="flex flex-col gap-1">
                    <span className="font-mono text-xs">{d} <span className="text-muted-foreground">(optional)</span></span>
                    <Choice compact value={dims[d]} onChange={(v) => setDims((prev) => ({ ...prev, [d]: v }))} />
                  </div>
                ))}
              </div>
            )}
            <textarea
              className="min-h-16 rounded-md border bg-background px-2 py-1.5 text-sm"
              placeholder="Note (optional): what made the difference"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
            />
            {error && <p className="text-sm text-bad">{error}</p>}
            <div className="flex items-center justify-end gap-2">
              <Button onClick={() => void save()} disabled={!overall || saving || session.revealed}>
                {session.revealed ? "Revealed: read-only" : saving ? "Saving…" : "Save and next (Enter)"}
              </Button>
            </div>
          </section>
        </>
      )}

      {!session.revealed && total > 0 && (
        <footer className="flex items-center justify-end gap-2 text-sm">
          {confirmReveal ? (
            <>
              <span className="text-muted-foreground">Reveal shows which candidate is which; your verdicts become read-only.</span>
              <Button variant="outline" size="sm" onClick={() => setConfirmReveal(false)}>Cancel</Button>
              <Button size="sm" onClick={() => void postReveal(runId, reviewer).then(load).catch((e: Error) => setError(e.message))}>Reveal</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmReveal(true)}>Reveal candidates…</Button>
          )}
        </footer>
      )}
    </div>
  );
}
