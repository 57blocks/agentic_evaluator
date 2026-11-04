/**
 * Cost against success, one dot per candidate. The layout is decided once in
 * report-scatter.ts, the same numbers report.html draws; this only paints
 * them in the dashboard's tokens. Hover titles are SVG `<title>`, so they
 * survive the HTML export, which carries no JavaScript.
 */

import type { CostSuccessChart, ScatterPoint } from "../../../../../report-scatter.js";
import { cn } from "@/lib/utils";

const f = (n: number): number => Math.round(n * 10) / 10;

function Mark({ p }: { p: ScatterPoint }) {
  const fill = p.gated ? "fill-card stroke-muted-foreground" : cn("stroke-card", p.chosen ? "fill-brand" : "fill-brand-2");
  const strokeWidth = p.gated ? 1.5 : 2;
  const { label } = p;
  return (
    <g>
      <title>{p.title}</title>
      <circle cx={f(p.cx)} cy={f(p.cy)} r={12} className="fill-transparent" />
      {label.leader && (
        <line
          x1={f(p.cx)}
          y1={f(p.cy)}
          x2={f(label.anchor === "start" ? label.x - 2 : label.x + 2)}
          y2={f(label.y - 4)}
          className="stroke-muted-foreground"
          strokeWidth={0.75}
        />
      )}
      {p.chosen && <circle cx={f(p.cx)} cy={f(p.cy)} r={9} className="fill-none stroke-brand" strokeWidth={2} />}
      {p.isControl ? (
        <rect x={f(p.cx - 5)} y={f(p.cy - 5)} width={10} height={10} rx={1.5} className={fill} strokeWidth={strokeWidth} />
      ) : (
        <circle cx={f(p.cx)} cy={f(p.cy)} r={5} className={fill} strokeWidth={strokeWidth} />
      )}
      <text
        x={f(label.x)}
        y={f(label.y)}
        textAnchor={label.anchor}
        className={cn("text-[11px]", p.chosen ? "fill-foreground font-bold" : p.gated ? "fill-muted-foreground" : "fill-foreground/80")}
      >
        {p.candidate}
      </text>
    </g>
  );
}

function Key({ className, children }: { className: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i aria-hidden className={cn("inline-block", className)} />
      {children}
    </span>
  );
}

export function CostSuccess({ chart }: { chart: CostSuccessChart }) {
  const { plot, frame } = chart;
  const tick = "fill-muted-foreground font-mono text-[11px]";
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
        aria-label="Required-check pass rate against generation cost per success, one point per candidate"
        className="h-auto w-full max-w-[760px] overflow-visible"
      >
        {chart.yTicks.map((t) => (
          <g key={t.label}>
            <line x1={frame.left} x2={frame.right} y1={f(t.at)} y2={f(t.at)} className="stroke-border" />
            <text x={frame.left - 8} y={f(t.at + 4)} textAnchor="end" className={tick}>{t.label}</text>
          </g>
        ))}
        {chart.lanes.map((l) => (
          <g key={l.label}>
            <line x1={f(l.x)} x2={f(l.x)} y1={plot.top} y2={plot.bottom} className="stroke-border" strokeDasharray="2 3" />
            <text x={f(l.x)} y={plot.bottom + 18} textAnchor="middle" className={tick}>{l.label}</text>
          </g>
        ))}
        {chart.xTicks.map((t) => (
          <text key={t.label} x={f(t.at)} y={plot.bottom + 18} textAnchor="middle" className={tick}>{t.label}</text>
        ))}
        {chart.gate && (
          <line x1={frame.left} x2={frame.right} y1={f(chart.gate.y)} y2={f(chart.gate.y)} className="stroke-bad" strokeWidth={1.5} strokeDasharray="6 4" />
        )}
        <text x={f((plot.left + plot.right) / 2)} y={chart.height - 4} textAnchor="middle" className="fill-muted-foreground text-[11px]">
          generation cost per success (log scale) — cheaper is left
        </text>
        {chart.points.map((p) => <Mark key={p.candidate} p={p} />)}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Key className="size-2.5 rounded-full bg-brand-2">passed every gate</Key>
        <Key className="size-2.5 rounded-full bg-card ring-[1.5px] ring-muted-foreground ring-inset">removed by a gate</Key>
        <Key className="size-2.5 rounded-full bg-brand ring-2 ring-brand ring-offset-2 ring-offset-card">recommended</Key>
        <Key className="size-2.5 rounded-[2px] bg-brand-2">control</Key>
        {chart.gate && <Key className="h-0 w-4.5 border-t-[1.5px] border-dashed border-bad">{chart.gate.label}</Key>}
      </figcaption>
    </figure>
  );
}
