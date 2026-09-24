/**
 * Direction: per-dimension pairwise win rate, 0–100, tie counts 0.5. Judge
 * opinion, shown next to the recommendation, never inside it.
 */

import type { PreferenceTable } from "../../../../../report-model.js";
import { tintStyle } from "./geometry";

export function Preference({ table }: { table: PreferenceTable | null }) {
  if (table === null) return null;
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-sm font-medium">
        Pairwise win rate by dimension (0-100) <span className="text-xs font-normal text-muted-foreground">a tie counts as half</span>
      </figcaption>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-sm">
          <thead>
            <tr>
              <th className="px-2 text-left text-xs font-medium text-muted-foreground">Candidate</th>
              {table.dims.map((d) => (
                <th key={d} className="px-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.candidate}>
                <td className="px-2 font-mono text-xs whitespace-nowrap">{row.candidate}</td>
                {row.cells.map((v, i) =>
                  v === null ? (
                    <td key={table.dims[i]} className="px-2 py-2 text-right text-muted-foreground">—</td>
                  ) : (
                    <td key={table.dims[i]} className="px-2 py-2 text-right font-mono tabular-nums" style={tintStyle(v, 0, 100)}>
                      {v.toFixed(0)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
