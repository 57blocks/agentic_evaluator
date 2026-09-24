/**
 * Dimension profile: what shape each candidate is — which dimension it wins
 * on relative to its own others — at a glance. The heatmap below carries the
 * precise values. Capped at three outlines; past that the shape is noise.
 */

import type { CandidateProfile } from "../../../../../report-charts.js";
import { SCORE_MAX } from "../../../../../report-format.js";
import { seriesColor } from "../tone";
import { scale } from "./geometry";

const MAX_SERIES = 3;
const W = 560;
const H = 400;
const CX = W / 2;
const CY = 196;
const R = 128;

interface Props {
  dims: string[];
  profiles: CandidateProfile[];
  saturated: string[];
  colorOf: Map<string, number>;
}

export function Radar({ dims, profiles, saturated, colorOf }: Props) {
  const drawable = profiles.filter((p) => dims.every((d) => p.scores[d] !== null));
  if (dims.length < 3 || drawable.length === 0) return null;

  // Every dimension saturated: the outlines would be one shape on top of
  // another, and drawing it invites reading a profile out of a grader that
  // never varied.
  if (dims.every((d) => saturated.includes(d))) {
    return (
      <figure className="flex flex-col gap-2">
        <figcaption className="text-sm font-medium">
          Mean score by dimension <span className="text-xs font-normal text-muted-foreground">not drawn</span>
        </figcaption>
        <p className="text-xs text-muted-foreground">
          Every candidate scored the same on every dimension; the shapes would overlap exactly and read as "evenly matched".
        </p>
      </figure>
    );
  }

  const series = drawable.slice(0, MAX_SERIES);
  const dropped = drawable.length - series.length;
  const n = dims.length;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const px = (i: number, r: number) => CX + r * Math.cos(ang(i));
  const py = (i: number, r: number) => CY + r * Math.sin(ang(i));
  const ring = (v: number) => dims.map((_, i) => `${px(i, scale(v, R)).toFixed(1)},${py(i, scale(v, R)).toFixed(1)}`).join(" ");

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-sm font-medium">
        Mean score by dimension <span className="text-xs font-normal text-muted-foreground">1 at the centre, 5 at the rim</span>
      </figcaption>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {series.map((p) => (
          <span key={p.candidate} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5" style={{ background: seriesColor(colorOf.get(p.candidate)) }} />
            <span className="font-mono">{p.candidate}</span> · {p.overall === null ? "—" : p.overall.toFixed(1)}/5
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Each candidate's score profile across dimensions">
        {[2, 3, 4, SCORE_MAX].map((v) => (
          <g key={v}>
            <polygon points={ring(v)} fill="none" stroke="var(--border)" />
            <text x={CX + 4} y={CY - scale(v, R) + 3} className="fill-muted-foreground text-[10px]">{v}</text>
          </g>
        ))}
        {dims.map((dim, i) => {
          const c = Math.cos(ang(i));
          const anchor = c > 0.3 ? "start" : c < -0.3 ? "end" : "middle";
          return (
            <g key={dim}>
              <line x1={CX} y1={CY} x2={px(i, R)} y2={py(i, R)} stroke="var(--border)" />
              <text x={px(i, R + 22)} y={py(i, R + 22) + 4} textAnchor={anchor} className="fill-muted-foreground text-[11px]">
                {dim}
              </text>
            </g>
          );
        })}
        {series.map((p) => {
          const color = seriesColor(colorOf.get(p.candidate));
          const pts = dims.map((d, i) => `${px(i, scale(p.scores[d] as number, R)).toFixed(1)},${py(i, scale(p.scores[d] as number, R)).toFixed(1)}`).join(" ");
          return (
            <g key={p.candidate}>
              <polygon points={pts} fill={color} fillOpacity={0.1} stroke={color} strokeWidth={2} />
              {dims.map((d, i) => {
                const v = p.scores[d] as number;
                return (
                  <circle key={d} cx={px(i, scale(v, R))} cy={py(i, scale(v, R))} r={4.5} fill={color} stroke="var(--card)" strokeWidth={2}>
                    <title>{`${p.candidate} · ${d}: ${v.toFixed(1)}/5`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
      {dropped > 0 && (
        <p className="text-xs text-muted-foreground">
          {dropped} more candidates not drawn - beyond three the shapes become unreadable; see the table below for the numbers.
        </p>
      )}
    </figure>
  );
}
