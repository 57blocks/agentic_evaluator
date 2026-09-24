/**
 * What the judge said, duel by duel. The tables above answer "who was
 * preferred"; these answer "why, and can I check it". A duel whose two
 * rounds disagreed is marked: by rule it counts as a tie.
 */

import type { EvaluationRow } from "../../../../../canon/rows.js";
import type { Winner } from "../../../../../types.js";
import { Tag } from "../Section";

function Pick({ winner, a, b }: { winner: Winner; a: string; b: string }) {
  if (winner === "tie") return <Tag tone="neutral">平</Tag>;
  return <Tag tone="ok" className="font-mono">{winner === "a" ? a : b}</Tag>;
}

function Dimensions({ row, a, b }: { row: EvaluationRow; a: string; b: string }) {
  const detail = row.dimension_detail;
  if (!detail) {
    // Older runs kept only the verdict per dimension; say it compactly.
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {Object.entries(row.dimensions ?? {}).map(([key, v]) => (
          <span key={key} className="inline-flex items-center gap-1">{key} <Pick winner={v as Winner} a={a} b={b} /></span>
        ))}
      </p>
    );
  }
  return (
    <table className="w-full text-sm">
      <tbody>
        {Object.entries(detail).map(([key, d]) => (
          <tr key={key} className="border-t border-border">
            <th className="w-px py-1.5 pr-4 text-left align-top text-xs font-medium whitespace-nowrap text-muted-foreground">{key}</th>
            <td className="w-px py-1.5 pr-3 align-top whitespace-nowrap">
              <Pick winner={d.resolved} a={a} b={b} />
              {d.forward !== d.reverse && <Tag tone="warn" className="ml-1">两轮不一致</Tag>}
            </td>
            <td className="py-1.5 align-top text-xs">{d.reason || <span className="text-muted-foreground">没有给理由</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Duel({ row }: { row: EvaluationRow }) {
  if (row.subject.kind !== "pair") return null;
  const { a, b, input } = row.subject;
  const calls = row.cost?.calls ?? 0;
  return (
    <article className="flex flex-col gap-2 border border-border p-3">
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono font-semibold">{a}</span>
        <span className="text-muted-foreground">vs</span>
        <span className="font-mono font-semibold">{b}</span>
        <span className="text-xs text-muted-foreground">· {input}</span>
        {row.overall !== undefined && <><span className="text-xs text-muted-foreground">胜者</span><Pick winner={row.overall as Winner} a={a} b={b} /></>}
        {row.state !== "pass" && <Tag tone="warn">{row.state === "evaluator_error" ? "裁判出错" : "未评估"}</Tag>}
        {calls > 2 && <Tag tone="neutral">调用 {calls} 次（含重试）</Tag>}
      </header>
      {row.evidence && <p className="text-sm text-muted-foreground">{row.evidence}</p>}
      <Dimensions row={row} a={a} b={b} />
    </article>
  );
}

export function Duels({ duels }: { duels: EvaluationRow[] }) {
  return <div className="flex flex-col gap-2">{duels.map((row, i) => <Duel key={i} row={row} />)}</div>;
}

/**
 * Duels that were actually judged come first: a pair the judge never saw
 * (a candidate with no output) says nothing, and must not push the ones that
 * do say something below the fold.
 */
export function judgedFirst(duels: readonly EvaluationRow[]): EvaluationRow[] {
  return [...duels].sort((x, y) => Number(y.state === "pass") - Number(x.state === "pass"));
}
