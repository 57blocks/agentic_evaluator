/**
 * One step's comparison, in the order `agenteval diff` prints it: did the
 * pick change, what changed in the setup, who crossed a gate, how each rate
 * moved (shared inputs apart from the rest), and which shared inputs flipped.
 * Every word and grouping comes from the diff itself (src/canon/run-diff.ts);
 * this file only lays it out.
 */

import type { Count, GateMove, RateWithInterval, RunDiff } from "../../../../canon/run-diff.js";
import { Note, Section, Tag, type TagTone } from "@/features/report/Section";
import { firmnessTone } from "@/lib/tone";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const MOVE_TONE: Record<GateMove, TagTone> = {
  LEFT: "bad",
  ENTERED: "ok",
  "new, in": "ok",
  "new, out": "neutral",
  dropped: "neutral",
  "stayed out": "neutral",
  "stayed in": "neutral",
  "not recorded": "warn",
};

const two = (v: number | null): string => (v === null ? "—" : v.toFixed(2));
const frac = (c: Count | null): string => (c === null || c.denominator === 0 ? "—" : `${c.numerator}/${c.denominator}`);

function RateCell({ r }: { r: RateWithInterval | null }) {
  if (r === null) return <span className="text-muted-foreground">not in this run</span>;
  if (r.denominator === 0) return <span>0/0</span>;
  return (
    <span className="tabular-nums">
      {r.numerator}/{r.denominator} <b>{two(r.value)}</b> <span className="text-muted-foreground">[{two(r.low)}–{two(r.high)}]</span>
    </span>
  );
}

function Pick({ pick }: { pick: { chosen: string | null; firmness: string | null } | null }) {
  if (pick === null) return <span className="text-muted-foreground">not recorded</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <b className="font-mono">{pick.chosen ?? "none"}</b>
      {pick.firmness && <Tag tone={firmnessTone(pick.firmness)}>{pick.firmness}</Tag>}
    </span>
  );
}

function Recommendation({ d }: { d: RunDiff }) {
  const { a, b, changed } = d.recommendation;
  return (
    <p className={`flex flex-wrap items-center gap-2 border-l-2 px-3 py-2 text-sm ${changed ? "border-warn bg-warn-soft" : "border-ok bg-ok-soft"}`}>
      <b>{changed ? "Recommendation changed:" : a === null || b === null ? "Recommendation:" : "Recommendation unchanged:"}</b>
      {changed || a === null || b === null ? (
        <>
          <Pick pick={a} /> → <Pick pick={b} />
        </>
      ) : (
        <Pick pick={b} />
      )}
    </p>
  );
}

function Setup({ d }: { d: RunDiff }) {
  const { shared, added, removed, changed } = d.inputs;
  const inputs = [`${shared} shared`, added.length ? `+${added.length} new` : "", removed.length ? `−${removed.length} dropped` : "", changed.length ? `${changed.length} with changed content` : ""]
    .filter(Boolean)
    .join(", ");
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">inputs</dt>
      <dd>{inputs}</dd>
      {d.setup.map((s) => (
        <div key={s.what} className="contents">
          <dt className="text-muted-foreground">{s.what}</dt>
          <dd className="font-mono text-[12px] break-all">
            {s.a || "—"} → {s.b || "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Gates({ d }: { d: RunDiff }) {
  return (
    <Table>
      <TableBody>
        {d.gates.map((g) => {
          const out = g.b.state === "out" ? g.b : g.a.state === "out" ? g.a : null;
          return (
            <TableRow key={g.candidate}>
              <TableCell className="w-28">
                <Tag tone={MOVE_TONE[g.move]}>{g.move}</Tag>
              </TableCell>
              <TableCell className="font-mono">{g.candidate}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{out && "reason" in out ? out.reason : ""}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Rates({ d }: { d: RunDiff }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Candidate</TableHead>
            <TableHead>Before</TableHead>
            <TableHead>After</TableHead>
            <TableHead>Shared inputs</TableHead>
            <TableHead>After, not shared</TableHead>
            <TableHead>Before, not shared</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.rates.map((r) => (
            <TableRow key={r.candidate}>
              <TableCell className="font-mono">{r.candidate}</TableCell>
              <TableCell><RateCell r={r.a} /></TableCell>
              <TableCell><RateCell r={r.b} /></TableCell>
              <TableCell className="tabular-nums">{frac(r.shared.a)} → {frac(r.shared.b)}</TableCell>
              <TableCell className="tabular-nums">{frac(r.onlyB)}</TableCell>
              <TableCell className="tabular-nums">{frac(r.onlyA)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Flips({ d }: { d: RunDiff }) {
  if (d.inputs.shared === 0) return <Note>The two runs share no input, so nothing can flip.</Note>;
  return (
    <div className="flex flex-col gap-2">
      {d.flipGroups.length === 0 && <p className="text-sm text-ok">None: every shared input kept its outcome.</p>}
      {d.flipGroups.map((g) => (
        <div key={`${g.candidate}-${g.direction}-${g.cause}`} className="flex flex-col gap-1 border border-border p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium">{g.candidate}</span>
            <Tag tone={g.direction === "fail-to-pass" ? "ok" : "bad"}>{g.direction === "fail-to-pass" ? "fail → pass" : "pass → fail"} ×{g.inputs.length}</Tag>
            <span className="text-muted-foreground">{[g.causeText, ...g.checkVersions.map((v) => `check ${v}`)].join("; ")}</span>
          </p>
          <p className="font-mono text-[12px] break-words text-muted-foreground">{g.inputs.join(", ")}</p>
        </div>
      ))}
      {d.notCompared > 0 && <Note>{d.notCompared} candidate × input pair(s) not compared: not run or not graded on one side.</Note>}
    </div>
  );
}

export function StepDiff({ d }: { d: RunDiff }) {
  return (
    <section aria-label={`Step ${d.b.step}`} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{d.a.step === d.b.step ? `Step ${d.b.step}` : `Steps ${d.a.step} → ${d.b.step}`}</h2>
      <Recommendation d={d} />
      <Section title="What changed between the runs">
        <Setup d={d} />
      </Section>
      <Section title="Gates" hint="Who entered or left the eligible set; the reason is the run's own.">
        <Gates d={d} />
      </Section>
      <Section title="Task success rate" hint="As each run recorded it, with its 95% interval; split into the inputs both runs share and the ones only one has.">
        <Rates d={d} />
      </Section>
      <Section title="Flips on shared inputs" hint="Inputs whose outcome moved, and whether the answer changed or the same answer was graded differently.">
        <Flips d={d} />
      </Section>
    </section>
  );
}
